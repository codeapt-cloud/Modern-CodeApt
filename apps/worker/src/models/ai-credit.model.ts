/**
 * Worker mirror of the AI credit LEDGER (kept in sync with
 * apps/api/src/models/ai-credit.model.ts). The worker charges essay grading to
 * a college at the gateway seam by reserving against the CURRENT period's ledger
 * row (created API-side at essay submit). The worker never creates ledgers or
 * computes allocation — if no row exists it simply doesn't meter (grading falls
 * back to deterministic), so a college is never over- or under-charged here.
 */
import { Schema, model, type InferSchemaType } from "mongoose";

const aiCreditLedgerSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: "College", required: true },
    periodKey: { type: String, required: true },
    allocated: { type: Number, required: true, default: 0, min: 0 },
    consumed: { type: Number, required: true, default: 0, min: 0 },
    byFeature: { type: Schema.Types.Mixed, default: () => ({}) },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
  },
  { timestamps: true },
);
aiCreditLedgerSchema.index({ college: 1, periodKey: 1 }, { unique: true });

export type AiCreditLedger = InferSchemaType<typeof aiCreditLedgerSchema>;
export const AiCreditLedgerModel = model(
  "AiCreditLedger",
  aiCreditLedgerSchema,
);
