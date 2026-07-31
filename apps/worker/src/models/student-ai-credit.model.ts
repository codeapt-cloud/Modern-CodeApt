/**
 * StudentAiCreditLedger — the PER-STUDENT AI credit distribution layer on top of
 * the Stage-1 college pool. The college_admin carves the college's per-period
 * pool into per-student allocations; a student spends only their own.
 *
 * One row per (college, student, period). `allocated` = what the admin gave this
 * student this period (SET, not accumulated); `consumed` = what they've spent
 * (atomic conditional $inc at the gateway seam); remaining = allocated − consumed.
 * Mirrors AiCreditLedger's shape + atomic-reserve pattern, keyed by student.
 *
 * Tenancy: carries `college` and is always read/written scoped to the college.
 * Reset: rows are per periodKey (monthly IST, same key as the pool) — a new
 * period simply has no rows, so nothing rolls over; the admin re-distributes.
 */
import { Schema, model, type InferSchemaType } from "mongoose";

const studentAiCreditLedgerSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: "College", required: true },
    student: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** Monthly period key `YYYY-MM` (IST) — same key as the college pool. */
    periodKey: { type: String, required: true },
    /** Credits the admin allocated to this student this period (SET-semantics). */
    allocated: { type: Number, required: true, default: 0, min: 0 },
    /** Credits the student has consumed this period. */
    consumed: { type: Number, required: true, default: 0, min: 0 },
    /** Consumption broken down by AI feature (feature → credits). */
    byFeature: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true },
);
// One ledger row per student per period (the allocate upsert + reserve key).
studentAiCreditLedgerSchema.index(
  { college: 1, student: 1, periodKey: 1 },
  { unique: true },
);
// Sum a college's period allocations fast (distributable math).
studentAiCreditLedgerSchema.index({ college: 1, periodKey: 1 });

export type StudentAiCreditLedger = InferSchemaType<
  typeof studentAiCreditLedgerSchema
>;

export const StudentAiCreditLedgerModel = model(
  "StudentAiCreditLedger",
  studentAiCreditLedgerSchema,
);
