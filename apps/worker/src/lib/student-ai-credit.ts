/**
 * Worker-side PER-STUDENT AI credit metering — the reserve/refund the gateway
 * seam uses to charge a STUDENT-initiated AI call (essay grading) to that
 * student's own allocation, when the college runs per-student distribution.
 *
 * Like the college metering, the worker NEVER creates a ledger (the admin
 * allocates in the API): it reserves against the student's CURRENT-period row.
 * No row (never allocated) or exhausted → the reserve fails and the caller
 * degrades gracefully to "no AI credits" — never overspending, never touching
 * the college pool again (the pool was committed at allocation time).
 *
 * Concurrency-safe: a single conditional atomic `$inc` that only succeeds when
 * it would not exceed the student's `allocated`.
 */
import { Types } from "mongoose";
import { aiActionWeight, aiCreditPeriodKey } from "@codeapt/shared";

import { StudentAiCreditLedgerModel } from "../models/student-ai-credit.model.js";

/** Atomically reserve the action's weight against the student's allocation. */
export async function reserveStudentCredits(
  collegeId: string,
  studentId: string,
  feature: string,
  now: Date,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(collegeId) || !Types.ObjectId.isValid(studentId)) {
    return false;
  }
  const periodKey = aiCreditPeriodKey(now);
  const weight = aiActionWeight(feature);
  const updated = await StudentAiCreditLedgerModel.findOneAndUpdate(
    {
      college: new Types.ObjectId(collegeId),
      student: new Types.ObjectId(studentId),
      periodKey,
      $expr: { $lte: [{ $add: ["$consumed", weight] }, "$allocated"] },
    },
    { $inc: { consumed: weight, [`byFeature.${feature}`]: weight } },
    { new: true },
  );
  return updated !== null;
}

/** Refund a reserved weight (the provider call failed after we reserved). */
export async function refundStudentCredits(
  collegeId: string,
  studentId: string,
  feature: string,
  now: Date,
): Promise<void> {
  if (!Types.ObjectId.isValid(collegeId) || !Types.ObjectId.isValid(studentId)) {
    return;
  }
  const periodKey = aiCreditPeriodKey(now);
  const weight = aiActionWeight(feature);
  await StudentAiCreditLedgerModel.updateOne(
    {
      college: new Types.ObjectId(collegeId),
      student: new Types.ObjectId(studentId),
      periodKey,
    },
    { $inc: { consumed: -weight, [`byFeature.${feature}`]: -weight } },
  );
}
