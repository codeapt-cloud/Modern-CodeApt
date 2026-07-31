/**
 * AI Test Builder — validation/coercion of LLM-generated questions into the
 * REAL exam-question shape (the same payload an imported or hand-authored
 * question has). The LLM is asked for questions but is untrusted: every item is
 * coerced here and DROPPED if it cannot be made into a valid MCQ_SINGLE /
 * MCQ_MULTI / CODE question. Nothing malformed is ever inserted.
 *
 * Pure + dependency-free (enums only): the server calls the LLM (via the shared
 * `callLlmChatJson`), hands the raw array here, then inserts only what survives.
 * Kept in @codeapt/shared so the coercion rules are unit-tested in isolation and
 * the web layer can share the constants.
 *
 * CODE test cases are best-effort: they are the LLM's PROPOSED expected outputs
 * (advisory) — they are not executed/validated here, so we never claim they are
 * verified.
 */
import {
  CODE_LANGUAGE_VALUES,
  CodeLanguage,
  ExamQuestionType,
  type CodeLanguage as CodeLanguageT,
  type ExamQuestionType as ExamQuestionTypeT,
} from "./enums.js";

/** Hard cap on questions generated per AI Build request — bounds LLM cost/time. */
export const MAX_AI_GENERATED_QUESTIONS = 20;

/** Hard cap on sections a Full-Exam AI Build may create — bounds cost/time. */
export const MAX_AI_EXAM_SECTIONS = 8;

/** Default/again-capped section duration (minutes) when the model omits/garbles it. */
const DEFAULT_SECTION_DURATION = 30;
const MAX_SECTION_DURATION = 240;

/** Default marks assigned when the model omits/garbles a marks value. */
const DEFAULT_MARKS = 5;

/** The engine's only real question types — the LLM is constrained to these. */
export const AI_GENERATABLE_TYPES: readonly ExamQuestionTypeT[] = [
  ExamQuestionType.MCQ_SINGLE,
  ExamQuestionType.MCQ_MULTI,
  ExamQuestionType.CODE,
];

export interface CoercedTestCase {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
  order: number;
}

/** A generated question, coerced into the exam-question shape (insert-ready). */
export interface CoercedGeneratedQuestion {
  type: ExamQuestionTypeT;
  text: string;
  marks: number;
  /** MCQ only. */
  options?: string[];
  /** MCQ only — 0-based indices into `options`. */
  correctOptions?: number[];
  /** CODE only (empty for MCQ). */
  starterCode: string;
  language: CodeLanguageT;
  allowedLanguages: CodeLanguageT[];
  /** CODE only — advisory (LLM-proposed, not executed). */
  testCases: CoercedTestCase[];
}

// --- primitive coercers ------------------------------------------------------

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;

function coerceMarks(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MARKS;
  return Math.min(100, Math.round(n));
}

function coerceLanguage(v: unknown): CodeLanguageT {
  return (CODE_LANGUAGE_VALUES as string[]).includes(asString(v))
    ? (v as CodeLanguageT)
    : CodeLanguage.PYTHON;
}

// --- type-specific coercers --------------------------------------------------

/**
 * MCQ: options must be ≥2 and all non-empty (interior blanks would shift the
 * 0-based correct indices, so a blank option is treated as malformed). Correct
 * indices are validated in-range + deduped. MCQ_SINGLE demands exactly one.
 */
function coerceMcq(
  obj: Record<string, unknown>,
  type: ExamQuestionTypeT,
  text: string,
  marks: number,
): CoercedGeneratedQuestion | null {
  const options = (Array.isArray(obj.options) ? obj.options : [])
    .map(asString)
    .map((s) => s.trim());
  if (options.length < 2 || options.some((s) => s.length === 0)) return null;

  const idx = Array.from(
    new Set(
      (Array.isArray(obj.correctOptions) ? obj.correctOptions : [])
        .map((v) => (typeof v === "number" ? v : Number(v)))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < options.length),
    ),
  ).sort((a, b) => a - b);
  if (idx.length === 0) return null;
  if (type === ExamQuestionType.MCQ_SINGLE && idx.length !== 1) return null;

  return {
    type,
    text,
    marks,
    options,
    correctOptions: idx,
    starterCode: "",
    language: CodeLanguage.PYTHON,
    allowedLanguages: [],
    testCases: [],
  };
}

function coerceCode(
  obj: Record<string, unknown>,
  text: string,
  marks: number,
): CoercedGeneratedQuestion {
  const allowedLanguages = (
    Array.isArray(obj.allowedLanguages) ? obj.allowedLanguages : []
  ).filter((l): l is CodeLanguageT =>
    (CODE_LANGUAGE_VALUES as string[]).includes(asString(l)),
  );
  const testCases: CoercedTestCase[] = (
    Array.isArray(obj.testCases) ? obj.testCases : []
  )
    .map(asRecord)
    .filter((tc): tc is Record<string, unknown> => tc !== null)
    .map((tc, i) => ({
      input: asString(tc.input),
      expectedOutput: asString(tc.expectedOutput),
      isHidden: tc.isHidden === true,
      order: i,
    }));
  return {
    type: ExamQuestionType.CODE,
    text,
    marks,
    starterCode: asString(obj.starterCode),
    language: coerceLanguage(obj.language),
    allowedLanguages,
    testCases,
  };
}

/**
 * Coerce a single raw LLM item into a valid question, or `null` if it can't be.
 * The type must be one of `allowedTypes` (which the caller has already
 * intersected with what the faculty asked for AND the three real types).
 */
export function coerceGeneratedQuestion(
  raw: unknown,
  allowedTypes: readonly ExamQuestionTypeT[],
): CoercedGeneratedQuestion | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const type = obj.questionType;
  if (
    typeof type !== "string" ||
    !allowedTypes.includes(type as ExamQuestionTypeT)
  ) {
    return null;
  }
  const text = asString(obj.text).trim();
  if (!text) return null;
  const marks = coerceMarks(obj.marks);

  if (type === ExamQuestionType.CODE) return coerceCode(obj, text, marks);
  return coerceMcq(obj, type as ExamQuestionTypeT, text, marks);
}

export interface CoerceResult {
  questions: CoercedGeneratedQuestion[];
  skipped: number;
  warnings: string[];
}

/**
 * Coerce a whole LLM batch: drop invalid items, cap the survivors at `cap`
 * (default the hard max), and summarize what was dropped as a warning. Never
 * throws — a non-array input yields an empty result.
 */
export function coerceGeneratedQuestions(
  rawList: unknown,
  allowedTypes: readonly ExamQuestionTypeT[],
  cap: number = MAX_AI_GENERATED_QUESTIONS,
): CoerceResult {
  const list = Array.isArray(rawList) ? rawList : [];
  const limit = Math.max(0, Math.min(cap, MAX_AI_GENERATED_QUESTIONS));
  const questions: CoercedGeneratedQuestion[] = [];
  let skipped = 0;
  for (const raw of list) {
    if (questions.length >= limit) {
      skipped += 1;
      continue;
    }
    const q = coerceGeneratedQuestion(raw, allowedTypes);
    if (q) questions.push(q);
    else skipped += 1;
  }
  const warnings: string[] = [];
  if (skipped > 0) {
    warnings.push(
      `${skipped} generated question${skipped === 1 ? "" : "s"} skipped ` +
        `(invalid, wrong type, or beyond the requested count).`,
    );
  }
  return { questions, skipped, warnings };
}

// --- Full-exam coercion (sections + their questions) -------------------------

/** A coerced section for a Full-Exam AI Build: metadata + insert-ready questions. */
export interface CoercedGeneratedSection {
  name: string;
  durationMinutes: number;
  questions: CoercedGeneratedQuestion[];
}

export interface CoerceSectionsResult {
  sections: CoercedGeneratedSection[];
  /** Total questions dropped across all sections (invalid / over the per-section cap). */
  skipped: number;
  warnings: string[];
}

function coerceSectionName(v: unknown, index: number): string {
  const s = asString(v).trim();
  return s || `Section ${index + 1}`;
}

function coerceDuration(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SECTION_DURATION;
  return Math.min(MAX_SECTION_DURATION, Math.round(n));
}

/**
 * Coerce a whole LLM-proposed EXAM into insert-ready sections. Caps the number of
 * sections (`maxSections`) and the questions per section (`maxPerSection`), drops
 * malformed questions, and drops any section left with zero valid questions.
 * Never throws — a non-array / empty input yields no sections.
 */
export function coerceGeneratedSections(
  rawSections: unknown,
  allowedTypes: readonly ExamQuestionTypeT[],
  caps: { maxSections?: number; maxPerSection?: number } = {},
): CoerceSectionsResult {
  const maxSections = Math.max(
    0,
    Math.min(caps.maxSections ?? MAX_AI_EXAM_SECTIONS, MAX_AI_EXAM_SECTIONS),
  );
  const maxPerSection = Math.max(
    0,
    Math.min(caps.maxPerSection ?? MAX_AI_GENERATED_QUESTIONS, MAX_AI_GENERATED_QUESTIONS),
  );
  const list = Array.isArray(rawSections) ? rawSections : [];

  const sections: CoercedGeneratedSection[] = [];
  let skipped = 0;
  let droppedEmptySections = 0;

  for (const rawSection of list) {
    if (sections.length >= maxSections) {
      droppedEmptySections += 1; // over the section cap
      continue;
    }
    const obj = asRecord(rawSection);
    if (!obj) {
      droppedEmptySections += 1;
      continue;
    }
    const { questions, skipped: qSkipped } = coerceGeneratedQuestions(
      obj.questions,
      allowedTypes,
      maxPerSection,
    );
    skipped += qSkipped;
    if (questions.length === 0) {
      droppedEmptySections += 1; // a section with no usable questions is useless
      continue;
    }
    sections.push({
      name: coerceSectionName(obj.name, sections.length),
      durationMinutes: coerceDuration(obj.durationMinutes),
      questions,
    });
  }

  const warnings: string[] = [];
  if (skipped > 0) {
    warnings.push(
      `${skipped} generated question${skipped === 1 ? "" : "s"} skipped ` +
        `(invalid, wrong type, or beyond the per-section limit).`,
    );
  }
  if (droppedEmptySections > 0) {
    warnings.push(
      `${droppedEmptySections} generated section${droppedEmptySections === 1 ? "" : "s"} skipped ` +
        `(no valid questions, or beyond the section limit).`,
    );
  }
  return { sections, skipped, warnings };
}
