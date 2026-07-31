/**
 * AI credit LEDGER (Stage 1) — one row per college per monthly period. Tracks
 * the allocation for the period and running consumption, so college-initiated AI
 * at the gateway seam can be metered atomically (reserve-before-route). The
 * allocation is computed at period creation from the college's tier/override +
 * live student count (see ai-credit.service); it is stored so the worker can
 * reserve against it without recomputing.
 *
 * Concurrency: the seam reserves via a conditional atomic `$inc` (only when it
 * would not exceed `allocated`), so parallel calls can never overspend the cap.
 */
import { Schema, model, type InferSchemaType } from "mongoose";

const aiCreditLedgerSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: "College", required: true },
    /** Monthly period key `YYYY-MM` (IST). */
    periodKey: { type: String, required: true },
    /** Credits granted for this period (override ?? tier.base + seats×perSeat). */
    allocated: { type: Number, required: true, default: 0, min: 0 },
    /** Credits consumed so far this period. */
    consumed: { type: Number, required: true, default: 0, min: 0 },
    /** Consumption broken down by AI feature (feature → credits). */
    byFeature: { type: Schema.Types.Mixed, default: () => ({}) },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
  },
  { timestamps: true },
);
// One ledger row per college per period (the reserve/ensure upsert key).
aiCreditLedgerSchema.index({ college: 1, periodKey: 1 }, { unique: true });

export type AiCreditLedger = InferSchemaType<typeof aiCreditLedgerSchema>;
export const AiCreditLedgerModel = model(
  "AiCreditLedger",
  aiCreditLedgerSchema,
);
