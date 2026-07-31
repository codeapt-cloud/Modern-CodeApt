/**
 * Pure helpers for the exam runner — countdown formatting + answer-state logic.
 * No I/O, no React; unit-tested independently of the (side-effectful) hook.
 */
import { ExamQuestionType, type SanitizedQuestion } from "@codeapt/shared";

/** A candidate's local, unsent answer for a question. */
export interface LocalAnswer {
  selectedOptions?: number[];
  code?: string;
  language?: string;
}

/** Format seconds as MM:SS (or H:MM:SS past an hour). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Whether a question has a non-empty answer (drives the navigator). */
export function isAnswered(
  question: SanitizedQuestion,
  answer: LocalAnswer | undefined,
): boolean {
  if (!answer) return false;
  if (question.type === ExamQuestionType.CODE) {
    return typeof answer.code === "string" && answer.code.trim().length > 0;
  }
  return (answer.selectedOptions?.length ?? 0) > 0;
}

/** Count of answered questions in a section. */
export function answeredCount(
  questions: readonly SanitizedQuestion[],
  answers: Readonly<Record<string, LocalAnswer>>,
): number {
  return questions.filter((q) => isAnswered(q, answers[q.id])).length;
}

/** Seed the local answer map from a section's saved answers. */
export function seedAnswers(
  questions: readonly SanitizedQuestion[],
): Record<string, LocalAnswer> {
  const map: Record<string, LocalAnswer> = {};
  for (const q of questions) {
    const saved = q.savedAnswer;
    if (!saved) continue;
    const entry: LocalAnswer = {};
    if (saved.selectedOptions) entry.selectedOptions = saved.selectedOptions;
    if (saved.code !== null) entry.code = saved.code;
    if (saved.language !== null) entry.language = saved.language;
    map[q.id] = entry;
  }
  return map;
}

/** True when the current section is the last one. */
export function isLastSection(
  sectionIndex: number,
  totalSections: number,
): boolean {
  return sectionIndex >= totalSections - 1;
}

// --- One-question-at-a-time navigation --------------------------------------

/**
 * A question's navigator state. "marked-*" carry the answered/unanswered
 * variant so a flagged-and-answered question reads differently from a flagged
 * blank one; the base four are not-visited / not-answered / answered / marked.
 */
export type QuestionStatus =
  | "not-visited"
  | "not-answered"
  | "answered"
  | "marked-answered"
  | "marked-unanswered";

/** Derive the navigator state from answered/visited/marked flags (pure). */
export function questionStatus(
  answered: boolean,
  visited: boolean,
  marked: boolean,
): QuestionStatus {
  if (marked) return answered ? "marked-answered" : "marked-unanswered";
  if (answered) return "answered";
  return visited ? "not-answered" : "not-visited";
}

/** True when `index` is the last question of a section of `total` questions. */
export function isLastQuestion(index: number, total: number): boolean {
  return index >= total - 1;
}

/** Clamp a jump target to the section's bounds (navigation is within-section). */
export function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

/** What "Save & Next" does: next question, else the existing section-advance. */
export type SaveNextAction = "next-question" | "advance-section" | "submit-exam";

/**
 * Decide the "Save & Next" action WITHOUT forking the section pipeline: within a
 * section it just advances the question; on the last question it delegates to
 * the existing advance (mid-exam) or submit (final section) flow.
 */
export function saveAndNextAction(
  index: number,
  totalQuestions: number,
  lastSection: boolean,
): SaveNextAction {
  if (!isLastQuestion(index, totalQuestions)) return "next-question";
  return lastSection ? "submit-exam" : "advance-section";
}
