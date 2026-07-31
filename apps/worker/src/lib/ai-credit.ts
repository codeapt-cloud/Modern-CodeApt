/**
 * Worker-side AI credit metering (Stage 1) — the reserve/refund the gateway seam
 * uses to charge COLLEGE-initiated AI (essay grading) to a college. Unlike the
 * API service this NEVER creates a ledger or computes allocation (the worker has
 * no College/User models): it reserves against the CURRENT period's existing
 * ledger row (the API created it at essay submit). If no row exists the reserve
 * simply fails → the caller degrades gracefully (no AI), never overspending.
 *
 * Concurrency-safe: the reserve is a single conditional atomic `$inc` that only
 * succeeds when it would not exceed `allocated`.
 */
import { Types } from "mongoose";
import { aiActionWeight, aiCreditPeriodKey } from "@codeapt/shared";

import { AiCreditLedgerModel } from "../models/ai-credit.model.js";

/** Atomically reserve the action's weight; false if exhausted / no ledger yet. */
export async function reserveCredits(
  collegeId: string,
  feature: string,
  now: Date,
): Promise<boolean> {
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

/** Refund a reserved weight (the provider call failed after we reserved). */
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
