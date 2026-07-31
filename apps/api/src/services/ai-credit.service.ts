/**
 * AI credit service (Stage 1) — the per-college monthly budget that meters
 * college-initiated AI at the gateway seam.
 *
 * Allocation = override ?? (tier.base + studentCount × tier.perSeat), computed
 * when a period's ledger is created (rollover) or when a super-admin changes the
 * tier/override. Metering is a concurrency-safe ATOMIC reserve: a conditional
 * `$inc` that only succeeds when it would not exceed `allocated`, so parallel
 * calls can't overspend the cap. The seam refunds on provider failure and never
 * reserves on a cache hit, so a college is debited only for successful, live,
 * college-initiated calls.
 *
 * Stage 2 (a global free-tier pool governor) hooks at the SAME seam, above this
 * per-college check — not here.
 */
import {
  Role,
  UserType,
  aiCreditPeriodBounds,
  aiCreditPeriodKey,
  aiCreditsRemaining,
  aiActionWeight,
  computeAiCreditAllocation,
  type AiCreditBalance,
  type SetCollegeCreditsInput,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { AiCreditLedgerModel } from "../models/ai-credit.model.js";
import { CollegeModel } from "../models/college.model.js";
import { UserModel } from "../models/user.model.js";

/** Live count of a college's enrolled students (the per-seat multiplier). */
export async function countCollegeStudents(collegeId: string): Promise<number> {
  return UserModel.countDocuments({
    college: new Types.ObjectId(collegeId),
    role: Role.STUDENT,
    userType: UserType.COLLEGE,
  });
}

interface CollegeCreditConfig {
  tier: string;
  monthlyOverride: number | null;
}

async function loadConfig(collegeId: string): Promise<CollegeCreditConfig> {
  const college = await CollegeModel.findById(collegeId).select("credits");
  if (!college) {
    throw new AppError("College not found", 404, "COLLEGE_NOT_FOUND");
  }
  return {
    tier: college.credits?.tier ?? "free",
    monthlyOverride: college.credits?.monthlyOverride ?? null,
  };
}

type LedgerDoc = InstanceType<typeof AiCreditLedgerModel>;

/**
 * Ensure the ledger row for a college's CURRENT period exists, computing the
 * allocation on first creation (rollover). Idempotent: `$setOnInsert` means a
 * concurrent ensure never clobbers consumption.
 */
export async function ensureLedger(
  collegeId: string,
  now: Date,
): Promise<LedgerDoc> {
  const periodKey = aiCreditPeriodKey(now);
  const existing = await AiCreditLedgerModel.findOne({
    college: new Types.ObjectId(collegeId),
    periodKey,
  });
  if (existing) return existing;

  const [config, studentCount] = await Promise.all([
    loadConfig(collegeId),
    countCollegeStudents(collegeId),
  ]);
  const allocated = computeAiCreditAllocation({
    tier: config.tier,
    monthlyOverride: config.monthlyOverride,
    studentCount,
  });
  const { start, end } = aiCreditPeriodBounds(periodKey);

  // Upsert so a concurrent ensure resolves to the same row (no double-alloc).
  await AiCreditLedgerModel.updateOne(
    { college: new Types.ObjectId(collegeId), periodKey },
    {
      $setOnInsert: {
        allocated,
        consumed: 0,
        byFeature: {},
        periodStart: start,
        periodEnd: end,
      },
    },
    { upsert: true },
  );
  return AiCreditLedgerModel.findOne({
    college: new Types.ObjectId(collegeId),
    periodKey,
  }) as Promise<LedgerDoc>;
}

/**
 * Atomically RESERVE the action's credit weight for a college. Returns true if
 * reserved (the debit is applied), false if it would exceed the allocation
 * (exhausted → the caller must NOT call a provider). Concurrency-safe: the
 * conditional `$inc` is a single atomic op.
 */
export async function reserveCredits(
  collegeId: string,
  feature: string,
  now: Date,
): Promise<boolean> {
  await ensureLedger(collegeId, now);
  const periodKey = aiCreditPeriodKey(now);
  const weight = aiActionWeight(feature);
  const updated = await AiCreditLedgerModel.findOneAndUpdate(
    {
      college: new Types.ObjectId(collegeId),
      periodKey,
      $expr: { $lte: [{ $add: ["$consumed", weight] }, "$allocated"] },
    },
    { $inc: { consumed: weight, [`byFeature.${feature}`]: weight } },
    { new: true },
  );
  return updated !== null;
}

/** Refund a previously reserved weight (a provider call failed after reserve). */
export async function refundCredits(
  collegeId: string,
  feature: string,
  now: Date,
): Promise<void> {
  const periodKey = aiCreditPeriodKey(now);
  const weight = aiActionWeight(feature);
  await AiCreditLedgerModel.updateOne(
    { college: new Types.ObjectId(collegeId), periodKey },
    { $inc: { consumed: -weight, [`byFeature.${feature}`]: -weight } },
  );
}

/** Advisory pre-check (not a reservation): does the college have >= weight left? */
export async function hasCreditsFor(
  collegeId: string,
  feature: string,
  now: Date,
): Promise<boolean> {
  const ledger = await ensureLedger(collegeId, now);
  return aiCreditsRemaining(ledger.allocated, ledger.consumed) >= aiActionWeight(feature);
}

function byFeatureRecord(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** The live balance for a college's current period (super-admin + operator view). */
export async function getCreditBalance(
  collegeId: string,
  now: Date,
): Promise<AiCreditBalance> {
  const [config, studentCount, ledger] = await Promise.all([
    loadConfig(collegeId),
    countCollegeStudents(collegeId),
    ensureLedger(collegeId, now),
  ]);
  return {
    collegeId,
    tier: config.tier as AiCreditBalance["tier"],
    monthlyOverride: config.monthlyOverride,
    studentCount,
    periodKey: ledger.periodKey,
    periodStart: ledger.periodStart.toISOString(),
    periodEnd: ledger.periodEnd.toISOString(),
    allocated: ledger.allocated,
    consumed: ledger.consumed,
    remaining: aiCreditsRemaining(ledger.allocated, ledger.consumed),
    byFeature: byFeatureRecord(ledger.byFeature),
  };
}

/**
 * Super-admin: set tier / explicit override / reset. Recomputes the CURRENT
 * period's allocation from the new config (so a change takes effect immediately)
 * and optionally zeroes consumption. Returns the fresh balance.
 */
export async function setCredits(
  collegeId: string,
  input: SetCollegeCreditsInput,
  now: Date,
): Promise<AiCreditBalance> {
  const college = await CollegeModel.findById(collegeId);
  if (!college) {
    throw new AppError("College not found", 404, "COLLEGE_NOT_FOUND");
  }
  if (!college.credits) college.credits = {} as typeof college.credits;
  if (input.tier !== undefined) college.credits.tier = input.tier;
  if (input.monthlyOverride !== undefined) {
    college.credits.monthlyOverride = input.monthlyOverride;
  }
  college.markModified("credits");
  await college.save();

  // Recompute the current period's allocation from the updated config.
  const periodKey = aiCreditPeriodKey(now);
  const { start, end } = aiCreditPeriodBounds(periodKey);
  const studentCount = await countCollegeStudents(collegeId);
  const allocated = computeAiCreditAllocation({
    tier: college.credits.tier,
    monthlyOverride: college.credits.monthlyOverride,
    studentCount,
  });
  const set: Record<string, unknown> = {
    allocated,
    periodStart: start,
    periodEnd: end,
  };
  const filter = { college: new Types.ObjectId(collegeId), periodKey };
  if (input.reset) {
    // Reset zeroes consumption for the current period.
    set.consumed = 0;
    set.byFeature = {};
    await AiCreditLedgerModel.updateOne(filter, { $set: set }, { upsert: true });
  } else {
    // Keep existing consumption; only initialize it if the row is new.
    await AiCreditLedgerModel.updateOne(
      filter,
      { $set: set, $setOnInsert: { consumed: 0, byFeature: {} } },
      { upsert: true },
    );
  }
  return getCreditBalance(collegeId, now);
}
