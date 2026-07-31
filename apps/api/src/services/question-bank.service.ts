/**
 * Question-bank service. Global banks (Standard = MCQ, Coding = CODE) are curated
 * by super-admin (CRUD + a categorized importer that REUSES the exam parsers).
 * A college's Self Bank is AUTO-POPULATED from that college's own imported /
 * created exam questions (tenant-scoped, deduped). Browse/filter is scope- and
 * grant-aware; pull-into-exam COPIES bank questions into an exam as real
 * ExamQuestions (+ ExamTestCases) by REUSING the exam question-creation path —
 * clean, because a BankQuestion's payload mirrors ExamQuestion field-for-field.
 */
import {
  AI_GENERATABLE_TYPES,
  BankKind,
  BankScope,
  CollegeFeature,
  ExamErrorCode,
  ExamQuestionType,
  TenantErrorCode,
  callLlmChatJson,
  checkEntitlement,
  coerceGeneratedQuestions,
  coerceGeneratedSections,
  hasLlmRouter,
  type AiGenerateExamRequest,
  type AiGenerateExamResponse,
  type AiGenerateQuestionsRequest,
  type AiGenerateQuestionsResponse,
  type CoercedGeneratedQuestion,
  type BankBrowseQuery,
  type BankFacets,
  type BankImportResponse,
  type BankListResponse,
  type BankPullIntoExamRequest,
  type BankPullIntoExamResponse,
  type BankQuestion,
  type BankQuestionUpsert,
  type CodeLanguage,
  type CollegeEntitlements,
  type ExamBulkUploadKind,
  type ExamQuestionType as ExamQuestionTypeT,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { logger } from "../lib/logger.js";
import { createTenantScope } from "../lib/tenant-scope.js";
import {
  parseBankCodingWorkbook,
  parseBankMcqWorkbook,
  type ParsedBankQuestion,
} from "../lib/question-bank-excel.js";
import type { ParsedQuestion } from "../lib/exam-excel.js";
import {
  BankQuestionModel,
  type BankQuestionDoc,
} from "../models/question-bank.model.js";
import { ExamModel, ExamSectionModel } from "../models/assessment.model.js";
import * as examAdmin from "./exam-admin.service.js";

type BankDoc = HydratedDocument<BankQuestionDoc>;

/** `kind` is DERIVED from the question type — never set independently. */
export function kindForType(type: ExamQuestionTypeT): BankKind {
  return type === ExamQuestionType.CODE ? BankKind.CODING : BankKind.STANDARD;
}

function toDTO(doc: BankDoc): BankQuestion {
  return {
    id: doc._id.toString(),
    scope: doc.scope as BankScope,
    college: doc.college ? doc.college.toString() : null,
    kind: doc.kind as BankKind,
    category: doc.category,
    subCategory: doc.subCategory ?? "",
    company: doc.company ?? "General",
    difficulty: doc.difficulty as BankQuestion["difficulty"],
    tags: doc.tags ?? [],
    questionType: doc.questionType as ExamQuestionTypeT,
    text: doc.text,
    options: doc.options ?? null,
    correctOptions: doc.correctOptions ?? null,
    starterCode: doc.starterCode ?? "",
    language: (doc.language ?? "python") as CodeLanguage,
    allowedLanguages: (doc.allowedLanguages ?? []) as CodeLanguage[],
    image: doc.image ?? "",
    marks: doc.marks,
    testCases: (doc.testCases ?? []).map((tc) => ({
      input: tc.inputData ?? "",
      expectedOutput: tc.expectedOutput ?? "",
      isHidden: tc.isHidden ?? false,
      order: tc.order ?? 0,
    })),
  };
}

/** Validate the type-specific payload of an upsert (mirrors the parser rules). */
function assertValidPayload(input: BankQuestionUpsert): void {
  if (input.questionType === ExamQuestionType.CODE) return;
  // MCQ_SINGLE / MCQ_MULTI
  if (!input.options || input.options.length < 2) {
    throw new AppError(
      "An MCQ needs at least 2 options",
      400,
      ExamErrorCode.EXAM_NOT_FOUND,
    );
  }
  if (!input.correctOptions || input.correctOptions.length === 0) {
    throw new AppError(
      "An MCQ needs at least 1 correct option",
      400,
      ExamErrorCode.EXAM_NOT_FOUND,
    );
  }
}

// --- Global bank CRUD (super-admin) -----------------------------------------

function embeddedTestCases(input: BankQuestionUpsert) {
  if (input.questionType !== ExamQuestionType.CODE) return [];
  return input.testCases.map((tc, i) => ({
    inputData: tc.input,
    expectedOutput: tc.expectedOutput,
    isHidden: tc.isHidden,
    order: tc.order ?? i,
  }));
}

export async function createGlobalBankQuestion(
  input: BankQuestionUpsert,
): Promise<BankQuestion> {
  assertValidPayload(input);
  const isCode = input.questionType === ExamQuestionType.CODE;
  const doc = await BankQuestionModel.create({
    scope: BankScope.GLOBAL,
    college: null,
    kind: kindForType(input.questionType),
    category: input.category,
    subCategory: input.subCategory,
    company: input.company,
    difficulty: input.difficulty,
    tags: input.tags,
    questionType: input.questionType,
    text: input.text,
    options: isCode ? undefined : input.options,
    correctOptions: isCode ? undefined : input.correctOptions,
    starterCode: isCode ? input.starterCode : "",
    language: input.language,
    allowedLanguages: isCode ? input.allowedLanguages : [],
    image: input.image,
    marks: input.marks,
    testCases: embeddedTestCases(input),
  });
  return toDTO(doc);
}

async function requireGlobalDoc(id: string): Promise<BankDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Bank question not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const doc = await BankQuestionModel.findOne({ _id: id, scope: BankScope.GLOBAL });
  if (!doc) {
    throw new AppError("Bank question not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  return doc;
}

export async function updateGlobalBankQuestion(
  id: string,
  input: BankQuestionUpsert,
): Promise<BankQuestion> {
  assertValidPayload(input);
  const doc = await requireGlobalDoc(id);
  const isCode = input.questionType === ExamQuestionType.CODE;
  doc.kind = kindForType(input.questionType);
  doc.category = input.category;
  doc.subCategory = input.subCategory;
  doc.company = input.company;
  doc.difficulty = input.difficulty;
  doc.tags = input.tags;
  doc.questionType = input.questionType;
  doc.text = input.text;
  doc.options = isCode ? undefined : input.options;
  doc.correctOptions = isCode ? undefined : input.correctOptions;
  doc.starterCode = isCode ? input.starterCode : "";
  doc.language = input.language;
  doc.allowedLanguages = isCode ? input.allowedLanguages : [];
  doc.image = input.image;
  doc.marks = input.marks;
  doc.set("testCases", embeddedTestCases(input));
  await doc.save();
  return toDTO(doc);
}

export async function deleteGlobalBankQuestion(
  id: string,
): Promise<{ deleted: true }> {
  const doc = await requireGlobalDoc(id);
  await BankQuestionModel.deleteOne({ _id: doc._id });
  return { deleted: true };
}

// --- Global bank importer (super-admin) — reuses the extended parsers --------

export async function importGlobalBank(
  fileBase64: string,
  kind: ExamBulkUploadKind,
): Promise<BankImportResponse> {
  const buffer = Buffer.from(fileBase64, "base64");
  const { questions, errors } =
    kind === "mcq"
      ? await parseBankMcqWorkbook(buffer)
      : await parseBankCodingWorkbook(buffer);

  let created = 0;
  let skipped = 0;
  for (const q of questions) {
    // De-dup a global bank by (scope, questionType, text).
    const exists = await BankQuestionModel.exists({
      scope: BankScope.GLOBAL,
      questionType: q.type,
      text: q.text,
    });
    if (exists) {
      skipped += 1;
      continue;
    }
    await BankQuestionModel.create(bankDocFromParsed(q, BankScope.GLOBAL, null));
    created += 1;
  }
  return { created, skipped, errors };
}

/** Build a BankQuestion doc from a parsed BANK row (importer). */
function bankDocFromParsed(
  q: ParsedBankQuestion,
  scope: BankScope,
  college: Types.ObjectId | null,
) {
  const isCode = q.type === ExamQuestionType.CODE;
  return {
    scope,
    college,
    kind: kindForType(q.type),
    category: q.category,
    subCategory: q.subCategory,
    company: q.company,
    difficulty: q.difficulty,
    tags: q.tags,
    questionType: q.type,
    text: q.text,
    options: isCode ? undefined : q.options,
    correctOptions: isCode ? undefined : q.correctOptions,
    starterCode: q.starterCode,
    language: q.language,
    allowedLanguages: q.allowedLanguages,
    marks: q.marks,
    testCases: q.testCases.map((tc, i) => ({
      inputData: tc.input,
      expectedOutput: tc.expectedOutput,
      isHidden: tc.isHidden,
      order: i,
    })),
  };
}

// --- Self-bank auto-populate (tenant-scoped) --------------------------------

/**
 * Persist a college's freshly-imported/created EXAM questions into its Self Bank
 * (college-scoped BankQuestions), deduped by (college, questionType, text). The
 * exam section name becomes the bank `category` (a sensible auto-grouping); the
 * rest of the metadata takes defaults (company "General", difficulty medium).
 * Additive: called AFTER the exam questions are created; never blocks the exam
 * upload (failures here don't corrupt the exam).
 */
export async function autoPopulateSelfBank(
  collegeId: string,
  parsed: ParsedQuestion[],
): Promise<{ created: number }> {
  const scope = createTenantScope(collegeId);
  let created = 0;
  for (const q of parsed) {
    const exists = await BankQuestionModel.exists(
      scope.filter({ scope: BankScope.COLLEGE, questionType: q.type, text: q.text }),
    );
    if (exists) continue;
    const isCode = q.type === ExamQuestionType.CODE;
    await BankQuestionModel.create(
      scope.attach({
        scope: BankScope.COLLEGE,
        kind: kindForType(q.type),
        category: q.sectionName || "General",
        subCategory: "",
        company: "General",
        difficulty: "medium",
        tags: [],
        questionType: q.type,
        text: q.text,
        options: isCode ? undefined : q.options,
        correctOptions: isCode ? undefined : q.correctOptions,
        starterCode: q.starterCode,
        language: q.language,
        allowedLanguages: q.allowedLanguages,
        marks: q.marks,
        testCases: q.testCases.map((tc, i) => ({
          inputData: tc.input,
          expectedOutput: tc.expectedOutput,
          isHidden: tc.isHidden,
          order: i,
        })),
      }),
    );
    created += 1;
  }
  return { created };
}

// --- Browse / filter ---------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Apply the categorical + free-text filters onto a base mongo filter. */
function applyFilters(
  base: Record<string, unknown>,
  query: BankBrowseQuery,
): Record<string, unknown> {
  const f: Record<string, unknown> = { ...base };
  if (query.kind) f.kind = query.kind;
  if (query.category) f.category = query.category;
  if (query.subCategory) f.subCategory = query.subCategory;
  if (query.company) f.company = query.company;
  if (query.difficulty) f.difficulty = query.difficulty;
  // `tags` is an array field — an equality match means "array contains value".
  if (query.tag) f.tags = query.tag;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    f.$or = [{ text: rx }, { tags: rx }];
  }
  return f;
}

const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

/** Non-empty, de-duped, locale-sorted string values from a `distinct` result. */
function cleanStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v !== ""))].sort(
    (a, b) => a.localeCompare(b),
  );
}

/**
 * DISTINCT filter values for the bar, computed with CASCADING (category-
 * dependent) facets:
 *  - PARENT facets — kind, category, company, difficulty — are distinct over the
 *    full scope + source `kind` only (never the soft filters), so you can always
 *    switch subject/company/difficulty.
 *  - CHILD facets narrow to the parent selection: sub-categories are scoped to
 *    the selected `category` (so they're the 6-12 sub-topics OF that subject, not
 *    a flat ~70-value wall across every subject); tags are scoped to the selected
 *    `category` (+ `subCategory` when chosen). This is standard cascading faceted
 *    search. Uses Mongo `distinct` per field. Always scope-/grant-respecting.
 */
async function computeFacets(
  scopeClause: Record<string, unknown>,
  query: BankBrowseQuery,
): Promise<BankFacets> {
  // Parent scope: the bank you're browsing (scope + source kind), no soft filters.
  const base: Record<string, unknown> = { ...scopeClause };
  if (query.kind) base.kind = query.kind;
  // Sub-category is scoped to the selected category; tags to category (+ subCat).
  const subCatFilter: Record<string, unknown> = { ...base };
  if (query.category) subCatFilter.category = query.category;
  const tagFilter: Record<string, unknown> = { ...subCatFilter };
  if (query.subCategory) tagFilter.subCategory = query.subCategory;

  const [kinds, categories, subCategories, companies, difficulties, tags] =
    await Promise.all([
      BankQuestionModel.distinct("kind", base),
      BankQuestionModel.distinct("category", base),
      BankQuestionModel.distinct("subCategory", subCatFilter),
      BankQuestionModel.distinct("company", base),
      BankQuestionModel.distinct("difficulty", base),
      BankQuestionModel.distinct("tags", tagFilter),
    ]);
  return {
    kinds: cleanStrings(kinds) as BankFacets["kinds"],
    categories: cleanStrings(categories),
    subCategories: cleanStrings(subCategories),
    companies: cleanStrings(companies),
    difficulties: (cleanStrings(difficulties) as BankFacets["difficulties"]).sort(
      (a, b) => (DIFFICULTY_ORDER[a] ?? 9) - (DIFFICULTY_ORDER[b] ?? 9),
    ),
    tags: cleanStrings(tags),
  };
}

async function runBrowse(
  scopeClause: Record<string, unknown>,
  query: BankBrowseQuery,
): Promise<BankListResponse> {
  const filter = applyFilters(scopeClause, query);
  const [total, docs, facets] = await Promise.all([
    BankQuestionModel.countDocuments(filter),
    BankQuestionModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize),
    computeFacets(scopeClause, query),
  ]);
  return {
    items: docs.map((d) => toDTO(d as BankDoc)),
    total,
    page: query.page,
    pageSize: query.pageSize,
    facets,
  };
}

/** Super-admin browse — the GLOBAL banks only. */
export function browseGlobalBank(
  query: BankBrowseQuery,
): Promise<BankListResponse> {
  return runBrowse({ scope: BankScope.GLOBAL }, query);
}

/**
 * College browse — the college's own Self Bank plus (if granted) the GLOBAL
 * banks. `scope=global` explicitly requested WITHOUT the grant → 403; `scope=all`
 * without the grant silently returns only the Self Bank.
 */
export function browseCollegeBank(
  collegeId: string,
  entitlements: CollegeEntitlements,
  query: BankBrowseQuery,
): Promise<BankListResponse> {
  const granted = checkEntitlement(entitlements, CollegeFeature.QUESTION_BANKS);
  const cid = new Types.ObjectId(collegeId);
  const clauses: Record<string, unknown>[] = [];

  if (query.scope === "global") {
    if (!granted) {
      throw new AppError(
        'This college does not have the "question_banks" feature enabled',
        403,
        TenantErrorCode.FEATURE_NOT_ENABLED,
        { feature: CollegeFeature.QUESTION_BANKS },
      );
    }
    clauses.push({ scope: BankScope.GLOBAL, college: null });
  } else if (query.scope === "college") {
    clauses.push({ scope: BankScope.COLLEGE, college: cid });
  } else {
    // "all": Self Bank always; global only if granted.
    clauses.push({ scope: BankScope.COLLEGE, college: cid });
    if (granted) clauses.push({ scope: BankScope.GLOBAL, college: null });
  }

  const scopeClause = clauses.length === 1 ? clauses[0]! : { $or: clauses };
  return runBrowse(scopeClause, query);
}

// --- Pull into exam ----------------------------------------------------------

/**
 * Copy a set of bank questions INTO a college exam section as real
 * ExamQuestions (+ ExamTestCases), reusing the exam question-creation path. The
 * exam + section must belong to THIS college (tenant-isolated). A college may
 * pull from its own Self Bank always, and from the GLOBAL banks only if granted;
 * another college's Self-Bank question is never pulled (skipped).
 */
export async function pullIntoExam(
  collegeId: string,
  entitlements: CollegeEntitlements,
  req: BankPullIntoExamRequest,
): Promise<BankPullIntoExamResponse> {
  const scope = createTenantScope(collegeId);

  // Exam must belong to this tenant (cross-tenant → not found).
  if (!Types.ObjectId.isValid(req.examId)) {
    throw new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const exam = await ExamModel.findOne(scope.filter({ _id: req.examId }));
  if (!exam) {
    throw new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const section = await ExamSectionModel.findOne({
    _id: req.sectionId,
    exam: exam._id,
  });
  if (!section) {
    throw new AppError("Section not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }

  const granted = checkEntitlement(entitlements, CollegeFeature.QUESTION_BANKS);
  const ids = req.questionIds.filter((id) => Types.ObjectId.isValid(id));
  const docs = await BankQuestionModel.find({ _id: { $in: ids } });

  // Trying to pull ANY global question without the grant is a hard denial.
  const wantsGlobal = docs.some((d) => d.scope === BankScope.GLOBAL);
  if (wantsGlobal && !granted) {
    throw new AppError(
      'This college does not have the "question_banks" feature enabled',
      403,
      TenantErrorCode.FEATURE_NOT_ENABLED,
      { feature: CollegeFeature.QUESTION_BANKS },
    );
  }

  const accessible = docs.filter((d) => {
    if (d.scope === BankScope.GLOBAL) return granted;
    // college scope → must be THIS college's Self Bank.
    return d.college != null && d.college.toString() === collegeId;
  });

  let pulled = 0;
  for (const d of accessible) {
    const isCode = d.questionType === ExamQuestionType.CODE;
    const { id: questionId } = await examAdmin.createQuestion({
      sectionId: section._id.toString(),
      type: d.questionType as ExamQuestionTypeT,
      text: d.text,
      order: 0,
      marks: d.marks,
      options: isCode ? undefined : (d.options ?? undefined),
      correctOptions: isCode ? undefined : (d.correctOptions ?? undefined),
      starterCode: d.starterCode ?? "",
      language: (d.language ?? "python") as CodeLanguage,
      allowedLanguages: (d.allowedLanguages ?? []) as CodeLanguage[],
      image: d.image ?? "",
    });
    if (isCode) {
      const cases = d.testCases ?? [];
      for (let i = 0; i < cases.length; i++) {
        const tc = cases[i]!;
        await examAdmin.addTestCase(questionId, {
          input: tc.inputData ?? "",
          expectedOutput: tc.expectedOutput ?? "",
          isHidden: tc.isHidden ?? false,
          order: i,
        });
      }
    }
    pulled += 1;
  }

  return { pulled, skipped: req.questionIds.length - pulled };
}

// --- AI Test Builder ---------------------------------------------------------
//
// Generate questions into an exam section via the SHARED LLM client (the one the
// essay flow uses — no new provider). The LLM output is untrusted: it is coerced
// into the real exam-question shape (`coerceGeneratedQuestions`) and only valid
// items are inserted, via the SAME createQuestion/addTestCase path pull-into-exam
// uses. Inserted questions are also auto-populated into the college Self Bank
// (best-effort), exactly as a bulk-upload does. Degrades gracefully when the LLM
// is not configured — never throws, never inserts a malformed question.

/**
 * Raw generation step, injectable for tests. Returns whether the LLM is
 * configured plus the RAW (untrusted) question array it produced.
 */
export type QuestionGenerator = (
  req: AiGenerateQuestionsRequest,
) => Promise<{ configured: boolean; raw: unknown[] }>;

const AI_SYSTEM_PROMPT =
  "You are an assessment author. Generate exam questions as STRICT JSON ONLY — " +
  "no prose, no code fences — exactly: " +
  '{"questions": [ { "questionType": "MCQ_SINGLE" | "MCQ_MULTI" | "CODE", ' +
  '"text": "<question>", "marks": <int>, ' +
  '"options": ["<opt>", ...], "correctOptions": [<0-based int>, ...], ' +
  '"starterCode": "<code>", "language": "python"|"javascript"|"java"|"cpp"|"c", ' +
  '"allowedLanguages": [], "testCases": [ {"input": "<stdin>", ' +
  '"expectedOutput": "<stdout>", "isHidden": false} ] } ] }. ' +
  "Rules: For MCQ_SINGLE provide 2-5 options and EXACTLY ONE correct index. For " +
  "MCQ_MULTI provide 2-5 options and one or more correct indices. Indices are " +
  "0-based into options. For CODE provide starterCode, a language, and 1-4 " +
  "test cases with plain stdin/stdout. Use ONLY the requested question types. " +
  "Do not include explanations outside the JSON.";

function buildAiUserPrompt(
  req: AiGenerateQuestionsRequest,
  sectionName: string,
): string {
  return (
    `Generate ${req.count} question(s) at ${req.difficulty} difficulty for the ` +
    `exam section "${sectionName}".\n` +
    `Allowed question types: ${req.questionTypes.join(", ")}.\n\n` +
    `Test description / topic:\n${req.description}`
  );
}

/** The real generator — the SHARED LLM client, configured like essay keyword-gen. */
function makeDefaultGenerator(
  sectionName: string,
  collegeId: string,
): QuestionGenerator {
  return async (req) => {
    // With the multi-provider gateway installed, provider creds live in the DB —
    // the legacy single-provider env vars are unset (and ignored). Only require
    // them when there is NO gateway (pure single-provider fallback). Mirrors
    // `createLlmGrader` in the worker.
    const configured =
      hasLlmRouter() ||
      (env.ESSAY_AI_PROVIDER === "llm" &&
        Boolean(env.ESSAY_LLM_URL) &&
        Boolean(env.ESSAY_LLM_API_KEY));
    if (!configured) return { configured: false, raw: [] };
    try {
      const parsed = await callLlmChatJson(
        {
          url: env.ESSAY_LLM_URL,
          apiKey: env.ESSAY_LLM_API_KEY,
          model: env.ESSAY_LLM_MODEL,
          timeoutMs: env.ESSAY_AI_TIMEOUT_MS,
        },
        AI_SYSTEM_PROMPT,
        buildAiUserPrompt(req, sectionName),
        // Authoring N questions is a heavier task → prefer a CAPABLE model; size
        // the output budget to the requested count (the gateway clamps to its
        // hard ceiling). Cacheable (identical spec → identical questions).
        {
          kind: "generation",
          capability: "capable",
          maxTokens: 200 + 300 * req.count,
          feature: "ai_build",
          // College-initiated authoring → charged to this college's AI credits.
          collegeId,
        },
      );
      const raw =
        parsed && typeof parsed === "object"
          ? (parsed as { questions?: unknown }).questions
          : undefined;
      return { configured: true, raw: Array.isArray(raw) ? raw : [] };
    } catch (err) {
      // callLlmChatJson never throws, but stay defensive: a failed call is a
      // "configured but produced nothing" outcome, not a crash.
      logger.warn({ err }, "AI question generation LLM error");
      return { configured: true, raw: [] };
    }
  };
}

/**
 * Generate + insert questions into a college exam section. Verifies the exam +
 * section belong to THIS tenant (cross-tenant → 404), calls the generator,
 * coerces/validates the output into real questions, inserts the valid ones via
 * the exam creation path, and mirrors them into the Self Bank. `generate` is
 * injectable so the LLM can be faked in tests.
 */
export async function generateQuestionsIntoExam(
  collegeId: string,
  _entitlements: CollegeEntitlements,
  req: AiGenerateQuestionsRequest,
  generate?: QuestionGenerator,
): Promise<AiGenerateQuestionsResponse> {
  const scope = createTenantScope(collegeId);

  if (!Types.ObjectId.isValid(req.examId)) {
    throw new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const exam = await ExamModel.findOne(scope.filter({ _id: req.examId }));
  if (!exam) {
    throw new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const section = await ExamSectionModel.findOne({
    _id: req.sectionId,
    exam: exam._id,
  });
  if (!section) {
    throw new AppError("Section not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }

  const generator = generate ?? makeDefaultGenerator(section.name, collegeId);
  const { configured, raw } = await generator(req);
  if (!configured) {
    return {
      configured: false,
      created: 0,
      skipped: 0,
      warnings: [
        "AI generation isn't configured. Contact your administrator to enable the AI provider.",
      ],
    };
  }

  // Only the real engine types the faculty actually requested.
  const allowedTypes = req.questionTypes.filter((t) =>
    AI_GENERATABLE_TYPES.includes(t),
  );
  const { questions, skipped, warnings } = coerceGeneratedQuestions(
    raw,
    allowedTypes,
    req.count,
  );

  const { created, parsed } = await insertQuestionsIntoSection(section, questions);
  if (parsed.length > 0) {
    try {
      await autoPopulateSelfBank(collegeId, parsed);
    } catch {
      /* self-bank mirroring is best-effort; the exam insert already succeeded */
    }
  }

  return { configured: true, created, skipped, warnings };
}

/**
 * Insert coerced questions into an existing section (via the exam-creation path,
 * so they're identical to any hand-authored question) and build the parallel
 * Self-Bank mirror rows. Shared by the per-section and full-exam AI builds.
 */
async function insertQuestionsIntoSection(
  section: { _id: Types.ObjectId; name: string },
  questions: CoercedGeneratedQuestion[],
): Promise<{ created: number; parsed: ParsedQuestion[] }> {
  let created = 0;
  const parsed: ParsedQuestion[] = [];
  for (const q of questions) {
    const isCode = q.type === ExamQuestionType.CODE;
    const { id: questionId } = await examAdmin.createQuestion({
      sectionId: section._id.toString(),
      type: q.type,
      text: q.text,
      order: created,
      marks: q.marks,
      options: isCode ? undefined : q.options,
      correctOptions: isCode ? undefined : q.correctOptions,
      starterCode: q.starterCode,
      language: q.language,
      allowedLanguages: q.allowedLanguages,
      image: "",
    });
    if (isCode) {
      for (let i = 0; i < q.testCases.length; i++) {
        const tc = q.testCases[i]!;
        await examAdmin.addTestCase(questionId, {
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          isHidden: tc.isHidden,
          order: i,
        });
      }
    }
    parsed.push({
      ref: `ai-${section._id.toString()}-${created}`,
      sectionName: section.name,
      sectionOrder: 0,
      sectionDuration: 0,
      order: created,
      type: q.type,
      text: q.text,
      marks: q.marks,
      options: q.options,
      correctOptions: q.correctOptions,
      starterCode: q.starterCode,
      language: q.language,
      allowedLanguages: q.allowedLanguages,
      testCases: q.testCases.map((tc) => ({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isHidden: tc.isHidden,
      })),
    });
    created += 1;
  }
  return { created, parsed };
}

// ---------------------------------------------------------------------------
// Full-Exam AI Build — the LLM designs the whole exam (sections + questions)
// ---------------------------------------------------------------------------

const FULL_EXAM_SYSTEM_PROMPT =
  "You are an assessment author. Design a COMPLETE exam as STRICT JSON ONLY — " +
  "no prose, no code fences — exactly: " +
  '{"sections": [ { "name": "<section name>", "durationMinutes": <int>, ' +
  '"questions": [ { "questionType": "MCQ_SINGLE" | "MCQ_MULTI" | "CODE", ' +
  '"text": "<question>", "marks": <int>, "options": ["<opt>", ...], ' +
  '"correctOptions": [<0-based int>, ...], "starterCode": "<code>", ' +
  '"language": "python"|"javascript"|"java"|"cpp"|"c", "allowedLanguages": [], ' +
  '"testCases": [ {"input": "<stdin>", "expectedOutput": "<stdout>", ' +
  '"isHidden": false} ] } ] } ] }. ' +
  "Rules: For MCQ_SINGLE provide 2-5 options and EXACTLY ONE correct index. For " +
  "MCQ_MULTI provide 2-5 options and one or more correct indices. Indices are " +
  "0-based into options. For CODE provide starterCode, a language, and 1-4 test " +
  "cases with plain stdin/stdout. Give each section a short descriptive name and " +
  "a sensible durationMinutes. Use ONLY the requested question types. Do not " +
  "include explanations outside the JSON.";

function buildFullExamUserPrompt(req: AiGenerateExamRequest): string {
  const total = req.sectionCount * req.questionsPerSection;
  return (
    `Design an exam with EXACTLY ${req.sectionCount} section(s). Put EXACTLY ` +
    `${req.questionsPerSection} question(s) in EACH section (do not return fewer) ` +
    `— ${total} questions in total — at ${req.difficulty} difficulty. Give each ` +
    `section a short name and a durationMinutes.\n` +
    `Allowed question types: ${req.questionTypes.join(", ")}.\n\n` +
    `Exam description / topic:\n${req.description}`
  );
}

/** Raw full-exam generation step, injectable for tests. */
export type ExamGenerator = (
  req: AiGenerateExamRequest,
) => Promise<{ configured: boolean; rawSections: unknown }>;

/** The real full-exam generator — the SHARED LLM client (gateway or fallback). */
function makeDefaultExamGenerator(collegeId: string): ExamGenerator {
  return async (req) => {
    const configured =
      hasLlmRouter() ||
      (env.ESSAY_AI_PROVIDER === "llm" &&
        Boolean(env.ESSAY_LLM_URL) &&
        Boolean(env.ESSAY_LLM_API_KEY));
    if (!configured) return { configured: false, rawSections: [] };
    try {
      const parsed = await callLlmChatJson(
        {
          url: env.ESSAY_LLM_URL,
          apiKey: env.ESSAY_LLM_API_KEY,
          model: env.ESSAY_LLM_MODEL,
          timeoutMs: env.ESSAY_AI_TIMEOUT_MS,
        },
        FULL_EXAM_SYSTEM_PROMPT,
        buildFullExamUserPrompt(req),
        // Whole-exam authoring is the heaviest task → prefer a CAPABLE model and
        // size the budget to sections × questions (the gateway clamps to its
        // hard ceiling). Cacheable (identical spec → identical exam).
        {
          kind: "generation",
          capability: "capable",
          maxTokens: 300 + 220 * req.sectionCount * req.questionsPerSection,
          feature: "ai_build",
          // College-initiated authoring → charged to this college's AI credits.
          collegeId,
        },
      );
      const raw =
        parsed && typeof parsed === "object"
          ? (parsed as { sections?: unknown }).sections
          : undefined;
      return { configured: true, rawSections: raw };
    } catch (err) {
      logger.warn({ err }, "AI full-exam generation LLM error");
      return { configured: true, rawSections: [] };
    }
  };
}

/**
 * Full-Exam AI Build: the LLM designs `sectionCount` sections (name + duration)
 * with up to `questionsPerSection` questions each; we CREATE the sections and
 * insert the valid questions (mirrored into the Self Bank), APPENDING after any
 * sections the exam already has. Verifies the exam belongs to THIS tenant.
 * Degrades gracefully (configured:false) when the LLM isn't set up.
 */
export async function generateFullExam(
  collegeId: string,
  _entitlements: CollegeEntitlements,
  req: AiGenerateExamRequest,
  generate?: ExamGenerator,
): Promise<AiGenerateExamResponse> {
  const scope = createTenantScope(collegeId);
  if (!Types.ObjectId.isValid(req.examId)) {
    throw new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }
  const exam = await ExamModel.findOne(scope.filter({ _id: req.examId }));
  if (!exam) {
    throw new AppError("Exam not found", 404, ExamErrorCode.EXAM_NOT_FOUND);
  }

  const generator = generate ?? makeDefaultExamGenerator(collegeId);
  const { configured, rawSections } = await generator(req);
  if (!configured) {
    return {
      configured: false,
      sectionsCreated: 0,
      created: 0,
      skipped: 0,
      warnings: [
        "AI generation isn't configured. Contact your administrator to enable the AI provider.",
      ],
    };
  }

  const allowedTypes = req.questionTypes.filter((t) =>
    AI_GENERATABLE_TYPES.includes(t),
  );
  const { sections, skipped, warnings } = coerceGeneratedSections(
    rawSections,
    allowedTypes,
    { maxSections: req.sectionCount, maxPerSection: req.questionsPerSection },
  );

  // Append after any existing sections so a full build never clobbers manual work.
  const existing = await ExamSectionModel.countDocuments({ exam: exam._id });

  let created = 0;
  let sectionsCreated = 0;
  const parsedForBank: ParsedQuestion[] = [];
  for (const sec of sections) {
    const sectionDoc = await ExamSectionModel.create({
      exam: exam._id,
      name: sec.name,
      order: existing + sectionsCreated,
      durationMinutes: sec.durationMinutes,
      description: "",
    });
    const { created: c, parsed } = await insertQuestionsIntoSection(
      { _id: sectionDoc._id, name: sec.name },
      sec.questions,
    );
    created += c;
    sectionsCreated += 1;
    parsedForBank.push(...parsed);
  }

  if (parsedForBank.length > 0) {
    try {
      await autoPopulateSelfBank(collegeId, parsedForBank);
    } catch {
      /* self-bank mirroring is best-effort; the exam insert already succeeded */
    }
  }

  return { configured: true, sectionsCreated, created, skipped, warnings };
}
