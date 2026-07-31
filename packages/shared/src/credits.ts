/**
 * AI CREDIT model (Stage 1) — pure, no I/O. The per-college monthly budget that
 * meters every COLLEGE-initiated AI action at the gateway seam so no single
 * college can drain the shared free-tier pool.
 *
 * Allocation (per monthly period):
 *   allocated = monthlyOverride ?? (tier.baseCredits + studentCount × tier.perSeatCredits)
 *
 * Debit unit is the ACTION WEIGHT (a small, token-cost-weighted integer per AI
 * action). Weights are the primary unit — a heavier action (a full-exam AI build
 * that emits many questions) costs more than a single essay grade. Cache hits
 * cost 0 (enforced at the seam: a hit returns before any reserve).
 *
 * Periods are monthly in IST (the app's tenant timezone); a new period gets a
 * freshly computed allocation (rollover). Stage 2 (a global pool governor) is
 * separate and hooks at the same seam — see the gateway glue.
 */
import { IST_OFFSET_MINUTES } from "./constants.js";
import { AiCreditTier, AI_CREDIT_TIER_VALUES } from "./enums.js";

const IST_MS = IST_OFFSET_MINUTES * 60_000;

export interface CreditTierConfig {
  /** Flat monthly credits every college on this tier gets. */
  baseCredits: number;
  /** Additional monthly credits per enrolled student (seat). */
  perSeatCredits: number;
}

/** The tier table. Numbers are Stage-1 defaults; tune without code changes elsewhere. */
export const AI_CREDIT_TIERS: Record<AiCreditTier, CreditTierConfig> = {
  [AiCreditTier.FREE]: { baseCredits: 100, perSeatCredits: 2 },
  [AiCreditTier.STANDARD]: { baseCredits: 500, perSeatCredits: 5 },
  [AiCreditTier.PREMIUM]: { baseCredits: 2000, perSeatCredits: 10 },
};

/** A college with no explicit tier is treated as FREE. */
export const DEFAULT_AI_CREDIT_TIER: AiCreditTier = AiCreditTier.FREE;

/**
 * Action weights keyed by the gateway `feature` label. Weighted by TYPICAL token
 * cost of the action. Unknown/absent features cost the default (1). Platform
 * features (daily_challenge) are never charged to a college, so their weight is
 * irrelevant here.
 */
export const AI_ACTION_WEIGHTS: Record<string, number> = {
  grading: 1, // essay grading (one LLM sub-score pass)
  essay_feedback: 1, // on-demand essay AI feedback
  keywords: 1, // essay keyword generation
  ai_build: 4, // exam/section AI build — emits many questions, big output
};
export const DEFAULT_AI_ACTION_WEIGHT = 1;

/** The credit cost of one AI action, by its gateway `feature` label. */
export function aiActionWeight(feature?: string): number {
  if (!feature) return DEFAULT_AI_ACTION_WEIGHT;
  return AI_ACTION_WEIGHTS[feature] ?? DEFAULT_AI_ACTION_WEIGHT;
}

function resolveTier(tier?: string | null): AiCreditTier {
  return (
    tier && (AI_CREDIT_TIER_VALUES as string[]).includes(tier)
      ? tier
      : DEFAULT_AI_CREDIT_TIER
  ) as AiCreditTier;
}

/**
 * The monthly allocation for a college: an explicit non-negative override wins;
 * otherwise base(tier) + students × per_seat(tier). Defensive about inputs.
 */
export function computeAiCreditAllocation(input: {
  tier?: string | null;
  monthlyOverride?: number | null;
  studentCount: number;
}): number {
  if (input.monthlyOverride != null && input.monthlyOverride >= 0) {
    return Math.floor(input.monthlyOverride);
  }
  const cfg = AI_CREDIT_TIERS[resolveTier(input.tier)];
  const seats = Math.max(0, Math.floor(input.studentCount || 0));
  return cfg.baseCredits + seats * cfg.perSeatCredits;
}

/** The monthly period key `YYYY-MM` (IST) an instant falls in. */
export function aiCreditPeriodKey(date: Date): string {
  const s = new Date(date.getTime() + IST_MS);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The UTC [start, end) instants of an IST monthly period key. */
export function aiCreditPeriodBounds(periodKey: string): {
  start: Date;
  end: Date;
} {
  const [y, m] = periodKey.split("-").map((n) => Number(n));
  const year = y ?? 1970;
  const month = (m ?? 1) - 1; // 0-based
  const start = new Date(Date.UTC(year, month, 1) - IST_MS);
  const end = new Date(Date.UTC(year, month + 1, 1) - IST_MS);
  return { start, end };
}

/** Remaining credits (never negative). */
export function aiCreditsRemaining(allocated: number, consumed: number): number {
  return Math.max(0, allocated - consumed);
}
