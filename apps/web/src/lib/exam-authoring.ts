/**
 * Pure helpers for the exam-authoring UI — the crux of the question editor:
 * mapping a question's `type` to which fields render, and encoding/decoding
 * `correctOptions` the way the backend stores it.
 *
 * VERIFIED against the real contracts (no client-side reinvention of rules):
 *  - `options` is a string[] (max 5). `correctOptions` is a number[] of
 *    0-BASED INDICES into `options` (candidate `selectedOptions` use the same
 *    0-based indexing — see QuestionCard `onToggle(idx)` and `gradeMcq`, which
 *    compares them as sorted sets).
 *  - MCQ_SINGLE = exactly one correct index; MCQ_MULTI = a set of indices.
 *  - CODE has no options/correctOptions; it carries starterCode + language and
 *    owns its test cases.
 *
 * The server re-validates every field (adminQuestionUpsertSchema); this mirrors
 * the schema only for inline UX, and keeps the encode/decode deterministic and
 * exhaustively testable (same spirit as the careers `applyAffordance` selector).
 */
import {
  CodeLanguage,
  ExamQuestionType,
  type AdminQuestionUpsert,
  type CodeLanguage as CodeLanguageT,
  type ExamQuestionType as ExamQuestionTypeT,
} from "@codeapt/shared";

export const MAX_OPTIONS = 5;

export function isMcq(type: ExamQuestionTypeT): boolean {
  return (
    type === ExamQuestionType.MCQ_SINGLE || type === ExamQuestionType.MCQ_MULTI
  );
}

export function isCode(type: ExamQuestionTypeT): boolean {
  return type === ExamQuestionType.CODE;
}

export function questionTypeLabel(type: ExamQuestionTypeT): string {
  switch (type) {
    case ExamQuestionType.MCQ_SINGLE:
      return "Single choice (MCQ)";
    case ExamQuestionType.MCQ_MULTI:
      return "Multiple choice (MCQ)";
    case ExamQuestionType.CODE:
      return "Coding";
    default:
      return type;
  }
}

const LANGUAGE_LABELS: Record<CodeLanguageT, string> = {
  [CodeLanguage.PYTHON]: "Python",
  [CodeLanguage.JAVASCRIPT]: "JavaScript",
  [CodeLanguage.JAVA]: "Java",
  [CodeLanguage.CPP]: "C++",
  [CodeLanguage.C]: "C",
};

export function codeLanguageLabel(language: CodeLanguageT): string {
  return LANGUAGE_LABELS[language] ?? language;
}

/** Which fields the question form should render for a given type. */
export interface QuestionFieldShape {
  options: boolean;
  /** Whether a "which option(s) are correct" control renders. */
  correct: boolean;
  /** true = single-pick (radio); false = multi-pick (checkboxes). */
  singleCorrect: boolean;
  starterCode: boolean;
  language: boolean;
  testCases: boolean;
}

export function fieldsForType(type: ExamQuestionTypeT): QuestionFieldShape {
  const mcq = isMcq(type);
  return {
    options: mcq,
    correct: mcq,
    singleCorrect: type === ExamQuestionType.MCQ_SINGLE,
    starterCode: isCode(type),
    language: isCode(type),
    testCases: isCode(type),
  };
}

/**
 * Drop blank option rows and REMAP the selected correct indices onto the
 * compacted array, so `correctOptions` always references positions that exist
 * in the `options` sent to the server. Correct indices pointing at removed
 * blanks are discarded.
 */
export function compactOptions(
  options: readonly string[],
  correct: readonly number[],
): { options: string[]; correct: number[] } {
  const kept: string[] = [];
  const oldToNew = new Map<number, number>();
  options.forEach((opt, oldIdx) => {
    if (opt.trim() === "") return;
    oldToNew.set(oldIdx, kept.length);
    kept.push(opt.trim());
  });
  const remapped = correct
    .map((c) => oldToNew.get(c))
    .filter((v): v is number => v !== undefined);
  return { options: kept, correct: remapped };
}

/**
 * Normalize selected correct indices for the given type: SINGLE keeps exactly
 * one (the lowest, if several somehow arrive); MULTI keeps a unique, sorted set.
 */
export function encodeCorrectOptions(
  type: ExamQuestionTypeT,
  correct: readonly number[],
): number[] {
  const unique = [...new Set(correct)].sort((a, b) => a - b);
  if (type === ExamQuestionType.MCQ_SINGLE) {
    return unique.length > 0 ? [unique[0]!] : [];
  }
  return unique;
}

/** Decode stored `correctOptions` (nullable) into a UI selection array. */
export function decodeCorrectOptions(
  correctOptions: readonly number[] | null | undefined,
): number[] {
  return correctOptions ? [...correctOptions] : [];
}

/** UI-side flat draft for a question being authored. */
export interface QuestionDraft {
  type: ExamQuestionTypeT;
  text: string;
  marks: number;
  /** Up to MAX_OPTIONS rows; blanks are dropped on submit. */
  options: string[];
  /** 0-based indices (into `options`) marked correct. */
  correctOptions: number[];
  starterCode: string;
  language: CodeLanguageT;
  /**
   * CODE language policy: [] = open (student picks any language), [lang] =
   * locked to that one. The authored `language` is the locked language when
   * locked, and the starter-code language when open.
   */
  allowedLanguages: CodeLanguageT[];
  /** Optional illustrative image URL (Cloudinary signed upload or pasted). */
  image: string;
}

export function emptyQuestionDraft(type: ExamQuestionTypeT): QuestionDraft {
  return {
    type,
    text: "",
    marks: 5,
    options: ["", "", "", ""],
    correctOptions: [],
    starterCode: "",
    language: CodeLanguage.PYTHON,
    allowedLanguages: [], // open by default (matches migrated questions)
    image: "",
  };
}

/** Locked when exactly one language is allowed; otherwise open (all). */
export function isPolicyLocked(
  allowedLanguages: readonly CodeLanguageT[],
): boolean {
  return allowedLanguages.length === 1;
}

/**
 * Field-level validation mirroring adminQuestionUpsertSchema for inline UX only
 * (the server is authoritative). Returns a map of field → message; empty = ok.
 */
export function validateQuestionDraft(
  draft: QuestionDraft,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.text.trim() === "") {
    errors.text = "Question text is required";
  }
  if (!Number.isInteger(draft.marks) || draft.marks < 0) {
    errors.marks = "Marks must be a non-negative whole number";
  }
  if (isMcq(draft.type)) {
    const { options, correct } = compactOptions(
      draft.options,
      draft.correctOptions,
    );
    if (options.length < 2) {
      errors.options = "Add at least two options";
    }
    if (draft.type === ExamQuestionType.MCQ_SINGLE && correct.length !== 1) {
      errors.correctOptions = "Select the correct option";
    }
    if (draft.type === ExamQuestionType.MCQ_MULTI && correct.length < 1) {
      errors.correctOptions = "Select at least one correct option";
    }
  }
  return errors;
}

/**
 * Map a validated draft to the server payload. MCQ questions send compacted
 * options + encoded correct indices; CODE questions omit options/correctOptions
 * and carry starterCode + language.
 */
export function toQuestionUpsert(
  draft: QuestionDraft,
  sectionId: string,
  order: number,
): AdminQuestionUpsert {
  const image = draft.image.trim();
  if (isCode(draft.type)) {
    // Locked → allow exactly the authored language; open → empty list.
    const allowedLanguages = isPolicyLocked(draft.allowedLanguages)
      ? [draft.language]
      : [];
    return {
      sectionId,
      type: draft.type,
      text: draft.text.trim(),
      order,
      marks: draft.marks,
      starterCode: draft.starterCode,
      language: draft.language,
      allowedLanguages,
      image,
    };
  }
  const { options, correct } = compactOptions(
    draft.options,
    draft.correctOptions,
  );
  return {
    sectionId,
    type: draft.type,
    text: draft.text.trim(),
    order,
    marks: draft.marks,
    options,
    correctOptions: encodeCorrectOptions(draft.type, correct),
    starterCode: "",
    language: CodeLanguage.PYTHON,
    allowedLanguages: [],
    image,
  };
}
