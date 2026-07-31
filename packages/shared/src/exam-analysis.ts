/**
 * Exam result analysis — pure, framework-free helpers (no mongoose/express) for
 * the per-exam analytics view. Kept pure so the aggregation math is unit-tested
 * in isolation and reused identically by the API service and the reports.
 *
 * Discipline mirrors the attendance/5a analytics: a rate over ZERO data is
 * `null` ("no data"), never a fabricated 0%.
 */

/** Number of score-distribution bands (deciles) in the histogram. */
export const EXAM_ANALYSIS_BANDS = 10;

/** A rounded percentage (1 dp) of part÷total, or null when there is no data. */
export function ratePercent(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

/** The median of a list (1 dp), or null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m =
    sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  return Math.round(m * 10) / 10;
}

export interface ScoreBand {
  label: string;
  /** Inclusive lower bound (%) . */
  min: number;
  /** Exclusive upper bound (%), except the top band which is inclusive of 100. */
  max: number;
  count: number;
}

/**
 * Bucket a list of PERCENTAGES (0–100) into `bands` equal-width bands for the
 * histogram. The top band is inclusive of 100 (so a perfect score lands in
 * "90–100", not a lonely overflow band). Values are clamped to [0,100].
 */
export function buildScoreBands(
  percents: readonly number[],
  bands: number = EXAM_ANALYSIS_BANDS,
): ScoreBand[] {
  const width = 100 / bands;
  const out: ScoreBand[] = Array.from({ length: bands }, (_v, i) => ({
    label: `${Math.round(i * width)}–${Math.round((i + 1) * width)}`,
    min: i * width,
    max: (i + 1) * width,
    count: 0,
  }));
  for (const raw of percents) {
    const p = Math.max(0, Math.min(100, raw));
    const idx = Math.min(bands - 1, Math.floor(p / width));
    out[idx]!.count += 1;
  }
  return out;
}
