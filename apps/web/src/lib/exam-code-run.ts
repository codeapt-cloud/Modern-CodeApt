/**
 * Pure builders + language-policy helpers for in-exam code test-runs. The exam
 * CODE editor lets a candidate test their code BEFORE submitting — against the
 * visible sample cases or a custom stdin — via the SAME async pipeline as the
 * playground (POST /execute + GET /execute/:jobId, driven by `useCodeRunner`).
 * Split out so the request shape + policy logic are unit-testable without a DOM.
 *
 * A test-run is NOT grading: it never touches Submit, never consumes an attempt,
 * and only ever sends the client-visible `sampleCases` (hidden cases live
 * server-side and are used solely by Submit).
 *
 * Language policy: a question's `allowedLanguages` is [] = OPEN (the student may
 * pick any supported language) or [lang] = LOCKED to that one. The CHOSEN
 * language drives the editor mode, Run, and Submit.
 */
import {
  CODE_LANGUAGE_VALUES,
  ExecutionPurpose,
  type CodeLanguage,
  type ExecuteRequest,
  type SanitizedQuestion,
} from "@codeapt/shared";

import { STARTER_SNIPPETS } from "./snippets.js";

/**
 * Purpose for in-exam runs: the plain playground queue (proven end-to-end), NOT
 * the assessment queue that Submit uses for grading.
 */
export const EXAM_RUN_PURPOSE = ExecutionPurpose.PLAYGROUND;

/**
 * Run the VISIBLE sample cases (graded run over `sampleCases` only) in the
 * student's CHOSEN language. Hidden cases are not present client-side and are
 * never included.
 */
export function buildSampleRunRequest(
  language: CodeLanguage,
  sampleCases: SanitizedQuestion["sampleCases"],
  code: string,
): ExecuteRequest {
  const samples = sampleCases ?? [];
  return {
    language,
    source: code,
    purpose: EXAM_RUN_PURPOSE,
    testCases: samples.map((c) => ({
      input: c.input,
      expectedOutput: c.expectedOutput,
    })),
  };
}

/** Run against a custom stdin (plain run, no test cases) in the chosen language. */
export function buildCustomRunRequest(
  language: CodeLanguage,
  code: string,
  stdin: string,
): ExecuteRequest {
  return {
    language,
    source: code,
    purpose: EXAM_RUN_PURPOSE,
    ...(stdin.length > 0 ? { stdin } : {}),
  };
}

/** A run needs non-empty source and an editor that isn't locked (submit/expiry). */
export function canRunCode(code: string, disabled?: boolean): boolean {
  return !disabled && code.trim().length > 0;
}

/** Whether this question offers a sample-case run (i.e. has visible samples). */
export function hasSampleCases(
  question: Pick<SanitizedQuestion, "sampleCases">,
): boolean {
  return (question.sampleCases ?? []).length > 0;
}

// --- Language policy ---------------------------------------------------------

type LanguagePolicy = Pick<SanitizedQuestion, "language" | "allowedLanguages">;

/** Locked when exactly one language is allowed; otherwise open (all supported). */
export function isLanguageLocked(allowedLanguages: CodeLanguage[]): boolean {
  return (allowedLanguages ?? []).length === 1;
}

/** The languages the student may pick: the single locked one, or all supported. */
export function languageChoices(
  allowedLanguages: CodeLanguage[],
): CodeLanguage[] {
  return isLanguageLocked(allowedLanguages)
    ? [allowedLanguages[0]!]
    : [...CODE_LANGUAGE_VALUES];
}

/** Initial language: the locked one when locked, else the authored default. */
export function defaultRunLanguage(question: LanguagePolicy): CodeLanguage {
  const allowed = question.allowedLanguages ?? [];
  if (allowed.length === 1) return allowed[0]!;
  return (question.language ?? "python") as CodeLanguage;
}

/**
 * Starter code for a chosen language: the AUTHORED starterCode for the
 * question's original language, otherwise a minimal per-language stub — so
 * switching languages (when open) never leaves an empty editor.
 */
export function stubForLanguage(
  chosen: CodeLanguage,
  question: Pick<SanitizedQuestion, "language" | "starterCode">,
): string {
  const authored = (question.language ?? "python") as CodeLanguage;
  if (chosen === authored) return question.starterCode ?? "";
  return STARTER_SNIPPETS[chosen];
}
