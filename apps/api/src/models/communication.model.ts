/**
 * CommunicationAssessment (Step 21) — an ordered CONTAINER over existing exam /
 * essay / speaking artifacts. It is NOT an engine and stores NO attempt state:
 * each part references an existing artifact by id + type, and a student's
 * progress + scores are READ from the underlying engine at report time (never
 * duplicated here). Mirrors the tenancy of GameSet / SpeakingAssessment — the
 * same three shapes (tenant-authored / course-attached / platform-internal),
 * org-unit targeting, and a draft→publish gate.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  COMMUNICATION_PART_TYPE_VALUES,
  CommunicationPartType,
} from "@codeapt/shared";

// --- One part (embedded, ordered) -------------------------------------------
const communicationPartSchema = new Schema(
  {
    // Position in the sequence the student progresses through.
    order: { type: Number, default: 0 },
    partType: {
      type: String,
      enum: COMMUNICATION_PART_TYPE_VALUES,
      default: CommunicationPartType.EXAM,
    },
    // Id of the referenced artifact — an Exam, EssayTopic, or SpeakingAssessment.
    // Kept as a bare ObjectId (not a typed ref) because the collection it points
    // at is chosen by `partType`; the service resolves it per type.
    ref: { type: Schema.Types.ObjectId, required: true },
    label: { type: String, required: true, trim: true },
    // Relative weight in the composite mean (> 0).
    weight: { type: Number, default: 1, min: 0 },
    // Gate: this part cannot be started until the PREVIOUS part is complete.
    requiresPrevious: { type: Boolean, default: false },
    // Optional wall-clock gate — the part opens no earlier than this instant
    // (multi-day rounds, e.g. Round 2 email on a later day). null = no date gate.
    availableFrom: { type: Date, default: null },
  },
  { _id: false },
);

const communicationAssessmentSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    topic: { type: Schema.Types.ObjectId, ref: "Topic", default: null },
    orgUnits: { type: [Schema.Types.ObjectId], ref: "OrgUnit", default: [] },
    isPublished: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    parts: { type: [communicationPartSchema], default: [] },
    // Band thresholds — the real papers use 50 / 60; authorable per assessment.
    passPercentage: { type: Number, default: 50, min: 0, max: 100 },
    distinctionPercentage: { type: Number, default: 60, min: 0, max: 100 },
  },
  { timestamps: true },
);
communicationAssessmentSchema.index({ college: 1 });
communicationAssessmentSchema.index({ topic: 1 });
export type CommunicationAssessment = InferSchemaType<
  typeof communicationAssessmentSchema
>;
export const CommunicationAssessmentModel = model(
  "CommunicationAssessment",
  communicationAssessmentSchema,
);
