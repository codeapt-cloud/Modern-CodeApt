/**
 * Essay anti-cheat RISK heuristic — pure, deterministic, ADVISORY ONLY.
 *
 * Ports the original Django app's additive risk model, adapted to the rebuild's
 * captured compose signals, with one improvement: it emits human-readable
 * REASONS for every signal that fired (so an admin sees WHY, not just a number).
 *
 * CRITICAL: this is advisory. The score/level/reasons are a signal admins
 * review — they NEVER penalize a student, affect a grade, block a submission,
 * or cancel an attempt. Fast, legitimate typers must not be harmed by a
 * false positive, so length-sensitive signals are normalized (e.g. paste ratio
 * is pasted-chars ÷ total-chars, not a raw count).
 *
 * Scoring is additive and capped at 100. Buckets: HIGH ≥ 80, MEDIUM ≥ 50,
 * else LOW. `suspicious` mirrors "MEDIUM or worse" (score ≥ 50).
 */

export const ESSAY_RISK_LEVELS = ["low", "medium", "high"] as const;
export type EssayRiskLevel = (typeof ESSAY_RISK_LEVELS)[number];

export const ESSAY_RISK_MEDIUM_THRESHOLD = 50;
export const ESSAY_RISK_HIGH_THRESHOLD = 80;

/**
 * The signals the heuristic reads. Names mirror the stored EssayAnalytics
 * sidecar. `focusLossCount` / `longestPauseSeconds` are supported but not
 * captured by the current composer (they stay 0 and simply never fire) — the
 * model is ready if that capture is added later.
 */
export interface EssayRiskSignals {
  keystrokes: number;
  deletes: number;
  pasteEvents: number;
  pastedChars: number;
  composeSeconds: number;
  wordCount: number;
  characterCount: number;
  focusLossCount?: number;
  longestPauseSeconds?: number;
}

export interface EssayRiskAssessment {
  /** 0..100 additive score, capped. */
  riskScore: number;
  level: EssayRiskLevel;
  /** Advisory flag: true at MEDIUM or worse. Never auto-penalizes. */
  suspicious: boolean;
  /** Human-readable explanation of each signal that fired (may be empty). */
  reasons: string[];
}

/** Coerce a possibly-missing signal to a safe, non-negative finite number. */
function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
}

function levelFor(score: number): EssayRiskLevel {
  if (score >= ESSAY_RISK_HIGH_THRESHOLD) return "high";
  if (score >= ESSAY_RISK_MEDIUM_THRESHOLD) return "medium";
  return "low";
}

/**
 * Compute an advisory risk assessment from captured compose signals. Missing or
 * partial signals are handled gracefully (absent → 0 → nothing fires → LOW/0).
 */
export function computeEssayRisk(
  signals: Partial<EssayRiskSignals>,
): EssayRiskAssessment {
  const keystrokes = num(signals.keystrokes);
  const pasteEvents = num(signals.pasteEvents);
  const pastedChars = num(signals.pastedChars);
  const wordCount = num(signals.wordCount);
  const characterCount = num(signals.characterCount);
  const focusLossCount = num(signals.focusLossCount);
  const longestPauseSeconds = num(signals.longestPauseSeconds);

  const reasons: string[] = [];
  let score = 0;

  // 1) High paste ratio with repeated pastes. Length-normalized so a long,
  //    legitimately-typed essay with one small quote isn't flagged.
  const pasteRatio = characterCount > 0 ? pastedChars / characterCount : 0;
  if (pasteRatio > 0.5 && pasteEvents > 3) {
    score += 50;
    reasons.push(
      `High paste ratio — ${Math.round(pasteRatio * 100)}% of the text was pasted across ${pasteEvents} pastes`,
    );
  }

  // 2) Very little typing for a substantial essay (pasted / pre-filled text).
  if (keystrokes < 10 && wordCount > 100) {
    score += 50;
    reasons.push(
      `Very low typing — only ${keystrokes} keystrokes for ${wordCount} words`,
    );
  }

  // 3) Abnormally large paste blocks (~5 chars/word approximation).
  if (pasteEvents > 0) {
    const wordsPerPaste = pastedChars / 5 / pasteEvents;
    if (wordsPerPaste > 50) {
      score += 30;
      reasons.push(
        `Large paste blocks — roughly ${Math.round(wordsPerPaste)} words per paste`,
      );
    }
  }

  // 4) Excessive focus loss (dormant until the composer captures it).
  if (focusLossCount > 5) {
    score += 25;
    reasons.push(`Frequent focus loss — left the editor ${focusLossCount} times`);
  }

  // 5) Long inactive pause (dormant until the composer captures it).
  if (longestPauseSeconds > 120) {
    score += 25;
    reasons.push(`Long inactive pause — ${longestPauseSeconds}s without typing`);
  }

  const riskScore = Math.min(100, score);
  return {
    riskScore,
    level: levelFor(riskScore),
    suspicious: riskScore >= ESSAY_RISK_MEDIUM_THRESHOLD,
    reasons,
  };
}
