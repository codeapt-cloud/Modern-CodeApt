/**
 * Optional "start code" gate shared by the exam-start seams (per-exam for
 * college exams; per-public-link for anonymous public links). The code is a
 * short value a faculty member / super-admin reads out right before the exam.
 *
 * Comparison is trimmed + case-insensitive (codes are dictated verbally). A
 * gate that is enabled but has no code configured is treated as OFF rather than
 * hard-locking a whole exam — the authoring schema already forbids that state.
 */
import { ExamErrorCode } from "@codeapt/shared";

import { AppError } from "../errors/app-error.js";

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/**
 * Enforce an access-code gate. No-op when the gate is disabled or misconfigured
 * (enabled but blank). Throws a 403 AppError with a machine code when a code is
 * required but missing or wrong — callers MUST invoke this BEFORE consuming an
 * attempt so a wrong guess never burns the student's attempt.
 */
export function assertAccessCode(
  enabled: boolean,
  expected: string | null | undefined,
  provided: string | null | undefined,
): void {
  if (!enabled) return;
  const want = normalize(expected);
  if (!want) return;
  const got = normalize(provided);
  if (!got) {
    throw new AppError(
      "This exam requires a start code. Ask the invigilator for the code.",
      403,
      ExamErrorCode.ACCESS_CODE_REQUIRED,
    );
  }
  if (got !== want) {
    throw new AppError(
      "Incorrect start code. Check the code with the invigilator and try again.",
      403,
      ExamErrorCode.ACCESS_CODE_INVALID,
    );
  }
}
