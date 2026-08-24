/**
 * Communication ASSESSMENT COMPOSITE — pure scoring (Step 21). The composite is
 * a CONTAINER over existing exam / essay / speaking artifacts; it does NOT score
 * any part itself (each engine keeps its own scoring, untouched). This module is
 * the pure glue: it bands a 0..100 percent against the real CTS paper's 50% pass
 * / 60% distinction, turns a speaking attempt's per-item sub-scores into ONE
 * comparable percent (mirroring the web speaking runner's derivation — kept as a
 * separate pure helper so the composite never imports UI code), and combines the
 * per-part percents by the authored weights into ONE composite result.
 *
 * The cardinal honesty rule lives here: a part that has NOT been taken/scored is
 * ABSENT from the weighted mean — never a zero. A composite over an incomplete
 * assessment is therefore reported as PARTIAL (with the scored/total weight), not
 * dragged down to a low score. `band` is null while partial: you cannot pass or
 * fail an assessment you have not finished.
 */

// ---------------------------------------------------------------------------
// Bands (the real papers: 50% pass, 60% distinction)
// ---------------------------------------------------------------------------

export const COMMUNICATION_PASS_PERCENT = 50;
export const COMMUNICATION_DISTINCTION_PERCENT = 60;

export type CommunicationBand = "distinction" | "pass" | "fail";

/** Band a 0..100 percent. Thresholds are authored per-assessment but default to
 *  the real papers' 50 / 60. */
export function communicationBand(
  percent: number,
  passPercent: number = COMMUNICATION_PASS_PERCENT,
  distinctionPercent: number = COMMUNICATION_DISTINCTION_PERCENT,
): CommunicationBand {
  if (percent >= distinctionPercent) return "distinction";
  if (percent >= passPercent) return "pass";
  return "fail";
}

// ---------------------------------------------------------------------------
// Speaking attempt → one comparable percent
// ---------------------------------------------------------------------------

/**
 * The single 0..100 headline for ONE speaking item's stored sub-score, or null
 * if the item has no score yet. Duck-typed over the stored score object so the
 * composite never couples to the exact score union: the read-aloud FAMILY has no
 * `kind` and reports `wordAccuracy`; the keyed variants report their own field.
 * This mirrors `itemScorePercent` in the web speaking runner (deliberately NOT
 * shared with it — moving that would touch the frozen speech-scoring surface).
 */
export function speakingItemPercent(score: unknown): number | null {
  if (!score || typeof score !== "object") return null;
  const s = score as Record<string, unknown>;
  if (!("kind" in s)) {
    return typeof s.wordAccuracy === "number" ? s.wordAccuracy : null;
  }
  switch (s.kind) {
    case "answer_set":
    case "fill_missing_word":
      return typeof s.score === "number" ? s.score : null;
    case "dictation":
      return typeof s.wordAccuracy === "number" ? s.wordAccuracy : null;
    case "story_retell":
    case "open_topic":
      return typeof s.total === "number" ? s.total : null;
    default:
      return null;
  }
}

/** Average of the SCORED items' percents (unscored/blank items don't drag the
 *  mean), or null when nothing is scored yet — the speaking part's percent. */
export function speakingOverallPercent(
  scores: readonly unknown[],
): number | null {
  const pcts: number[] = [];
  for (const sc of scores) {
    const p = speakingItemPercent(sc);
    if (p !== null) pcts.push(p);
  }
  if (pcts.length === 0) return null;
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  return Math.round(mean * 10) / 10;
}

// ---------------------------------------------------------------------------
// Composite (weighted mean over SCORED parts only)
// ---------------------------------------------------------------------------

/** One part's contribution to the composite. `percent` is null when the part is
 *  not scored yet (not taken, still grading, or removed) — such a part is absent
 *  from the mean, never a zero. `weight` should be > 0; a non-positive weight is
 *  clamped to 0 (the part still shows, but contributes nothing). */
export interface CompositePartInput {
  readonly weight: number;
  readonly percent: number | null;
}

export interface CompositeResult {
  /** Weighted mean over scored parts, or null if NONE are scored. */
  readonly compositePercent: number | null;
  /** Band of the composite — ONLY when every part is scored (a partial
   *  assessment cannot pass or fail). Null while partial or empty. */
  readonly band: CommunicationBand | null;
  /** True when at least one part is not yet scored — the composite is a
   *  running subtotal, not a final result. */
  readonly partial: boolean;
  /** Summed weight of the scored parts and of ALL parts, so a caller can show
   *  "you have completed 2 of 4 parts (60% of the weight)". */
  readonly scoredWeight: number;
  readonly totalWeight: number;
  readonly scoredCount: number;
  readonly totalCount: number;
}

/**
 * Combine per-part percents by weight. Only SCORED parts (percent !== null)
 * enter the mean and the denominator, so the result is the student's average
 * over what they have actually completed — with `partial` flagging that more is
 * outstanding. An assessment with zero parts, or none scored, yields a null
 * percent + null band (nothing to report yet), never 0.
 */
export function computeComposite(
  parts: readonly CompositePartInput[],
  passPercent: number = COMMUNICATION_PASS_PERCENT,
  distinctionPercent: number = COMMUNICATION_DISTINCTION_PERCENT,
): CompositeResult {
  let weightedSum = 0;
  let scoredWeight = 0;
  let totalWeight = 0;
  let scoredCount = 0;
  for (const p of parts) {
    const w = p.weight > 0 ? p.weight : 0;
    totalWeight += w;
    if (p.percent !== null) {
      weightedSum += w * p.percent;
      scoredWeight += w;
      scoredCount += 1;
    }
  }
  const totalCount = parts.length;
  const complete = totalCount > 0 && scoredCount === totalCount;
  const partial = totalCount > 0 && scoredCount < totalCount;

  // A scored part with zero weight can't define a mean; guard the divisor.
  const compositePercent =
    scoredCount === 0 || scoredWeight === 0
      ? null
      : Math.round((weightedSum / scoredWeight) * 10) / 10;

  return {
    compositePercent,
    band:
      complete && compositePercent !== null
        ? communicationBand(compositePercent, passPercent, distinctionPercent)
        : null,
    partial,
    scoredWeight,
    totalWeight,
    scoredCount,
    totalCount,
  };
}
