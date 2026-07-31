/**
 * Pure (React/DOM-free) helpers for the question-bank UI — the filter-state →
 * browse-query mapping and the picker's add/select tracking. Kept here so they
 * unit-test cleanly and both the college picker and the super-admin screen share
 * one source of truth. Wire to the REAL backend params (bankBrowseQuerySchema:
 * scope, kind, category, subCategory, company, difficulty, tag, q, page,
 * pageSize). Filter facets are computed SERVER-SIDE across the whole bank and
 * returned on the browse response (see `emptyBankFacets`) — never page-derived.
 */
import {
  BankKind,
  BankScope,
  ExamQuestionType,
  MAX_AI_EXAM_SECTIONS,
  MAX_AI_GENERATED_QUESTIONS,
  type AiGenerateExamRequest,
  type AiGenerateQuestionsRequest,
  type BankBrowseQuery,
  type BankFacets,
  type BankQuestionUpsert,
  type BankTestCase,
  type ExamQuestionType as ExamQuestionTypeT,
  type QuestionDifficulty,
} from "@codeapt/shared";

import { toQuestionUpsert, type QuestionDraft } from "./exam-authoring.js";

/** The three picker entry points in the exam editor. */
export type BankSource = "standard" | "coding" | "self";

/** The scope/kind a source reads: Standard/Coding = the GLOBAL banks (by kind);
 * Self = the college's own bank (both kinds). */
export function bankSourceQuery(source: BankSource): {
  scope: BankScope | "all";
  kind?: BankKind;
} {
  switch (source) {
    case "standard":
      return { scope: BankScope.GLOBAL, kind: BankKind.STANDARD };
    case "coding":
      return { scope: BankScope.GLOBAL, kind: BankKind.CODING };
    case "self":
    default:
      return { scope: BankScope.COLLEGE };
  }
}

/** UI filter state for the search box + chip rows. Empty string = "All". */
export interface BankFilterState {
  q: string;
  category: string;
  subCategory: string;
  company: string;
  difficulty: "" | QuestionDifficulty;
  tag: string;
}

export function emptyBankFilters(): BankFilterState {
  return { q: "", category: "", subCategory: "", company: "", difficulty: "", tag: "" };
}

/** An empty facet set — the fallback while a browse response is loading. */
export function emptyBankFacets(): BankFacets {
  return {
    kinds: [],
    categories: [],
    subCategories: [],
    companies: [],
    difficulties: [],
    tags: [],
  };
}

/**
 * Build the paginated browse query from a source + filter state. Drops empty
 * facets (so the backend treats them as "no filter"); a source `kind` is only
 * applied for the global banks, and the free-text box maps to `q`.
 */
export function buildBankBrowseQuery(
  source: BankSource,
  filters: BankFilterState,
  page: number,
  pageSize = 20,
): BankBrowseQuery {
  const src = bankSourceQuery(source);
  const query: BankBrowseQuery = { scope: src.scope, page, pageSize };
  if (src.kind) query.kind = src.kind;
  const q = filters.q.trim();
  if (q) query.q = q;
  if (filters.category) query.category = filters.category;
  if (filters.subCategory) query.subCategory = filters.subCategory;
  if (filters.company) query.company = filters.company;
  if (filters.difficulty) query.difficulty = filters.difficulty;
  if (filters.tag) query.tag = filters.tag;
  return query;
}

/** Toggle an id in a selection set (immutably), for multi-select "Add selected". */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** The total page count for a browse response (never below 1). */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** Bank metadata authored in the super-admin editor (alongside the payload). */
export interface BankMeta {
  category: string;
  subCategory: string;
  company: string;
  difficulty: QuestionDifficulty;
  tags: string[];
}

/**
 * Build a super-admin bank upsert from the shared exam QuestionDraft (reusing
 * `toQuestionUpsert`'s option-compaction + code-field encoding — no drift) plus
 * the bank metadata + inline test cases. Test cases are dropped for non-CODE.
 */
export function bankUpsertFromDraft(
  draft: QuestionDraft,
  meta: BankMeta,
  testCases: readonly BankTestCase[],
): BankQuestionUpsert {
  const q = toQuestionUpsert(draft, "_", 0);
  const isCode = q.type === ExamQuestionType.CODE;
  return {
    category: meta.category.trim(),
    subCategory: meta.subCategory.trim(),
    company: meta.company.trim() || "General",
    difficulty: meta.difficulty,
    tags: meta.tags.map((t) => t.trim()).filter(Boolean),
    questionType: q.type,
    text: q.text,
    marks: q.marks,
    options: q.options,
    correctOptions: q.correctOptions,
    starterCode: q.starterCode,
    language: q.language,
    allowedLanguages: q.allowedLanguages,
    image: q.image,
    testCases: isCode ? [...testCases] : [],
  };
}

/** Split a comma/newline-separated tags input into a clean string[]. */
export function parseTagsInput(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// --- AI Test Builder ---------------------------------------------------------

/**
 * Form state for the exam-level AI Build dialog. AI Build is a WHOLE-EXAM action:
 * it generates `perSection` questions of the chosen types/difficulty into EACH of
 * the exam's existing sections (total = sections × perSection), so section names
 * steer per-section generation. The count sent per section is `perSection`.
 */
export interface AiBuilderState {
  description: string;
  /** Only the engine's real types are selectable. */
  types: ExamQuestionTypeT[];
  /** Questions to generate into EACH section / the target section (server-capped). */
  perSection: number;
  /** Sections a FULL-EXAM build should create (ignored by the per-section build). */
  sectionCount: number;
  difficulty: QuestionDifficulty;
}

export function emptyAiBuilderState(): AiBuilderState {
  return {
    description: "",
    types: [ExamQuestionType.MCQ_SINGLE],
    perSection: 5,
    sectionCount: 3,
    difficulty: "medium",
  };
}

/** Clamp a value into [1, MAX_AI_GENERATED_QUESTIONS]. */
export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_AI_GENERATED_QUESTIONS, Math.floor(n)));
}

/** Clamp a section count into [1, MAX_AI_EXAM_SECTIONS]. */
export function clampSectionCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_AI_EXAM_SECTIONS, Math.floor(n)));
}

/**
 * Validate the builder form. Returns an error message to show, or null when the
 * form is ready to submit.
 */
export function validateAiBuilderState(state: AiBuilderState): string | null {
  if (!state.description.trim()) return "Describe the test you want to generate.";
  if (state.types.length === 0) return "Pick at least one question type.";
  if (state.perSection < 1) return "Generate at least one question per section.";
  if (state.perSection > MAX_AI_GENERATED_QUESTIONS) {
    return `You can generate at most ${MAX_AI_GENERATED_QUESTIONS} questions per section.`;
  }
  return null;
}

/**
 * Build the AI-generate request for ONE target section (the dialog calls this
 * per section). `count` is the per-section quantity, clamped to the cap.
 */
export function buildAiGenerateRequest(
  state: AiBuilderState,
  examId: string,
  sectionId: string,
): AiGenerateQuestionsRequest {
  return {
    examId,
    sectionId,
    description: state.description.trim(),
    questionTypes: [...state.types],
    count: clampCount(state.perSection),
    difficulty: state.difficulty,
  };
}

/**
 * Build the FULL-EXAM AI-build request: the LLM designs `sectionCount` sections
 * with up to `perSection` questions each. Both counts are clamped to their caps.
 */
export function buildAiGenerateExamRequest(
  state: AiBuilderState,
  examId: string,
): AiGenerateExamRequest {
  return {
    examId,
    description: state.description.trim(),
    questionTypes: [...state.types],
    sectionCount: clampSectionCount(state.sectionCount),
    questionsPerSection: clampCount(state.perSection),
    difficulty: state.difficulty,
  };
}
