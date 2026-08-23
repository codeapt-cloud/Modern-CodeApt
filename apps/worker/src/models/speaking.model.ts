/**
 * Speaking models (worker copy). Maps onto the SAME collections the API writes
 * (`speakingassessments`, `speakingattempts`) so the speech processor can read
 * an item's referenceText and write back the transcript / word timings / score.
 * Indexes are owned by the API copy.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  SPEAKING_ATTEMPT_STATUS_VALUES,
  SPEAKING_ITEM_TYPE_VALUES,
  SPEECH_JOB_STATUS_VALUES,
  SpeakingAttemptStatus,
  SpeakingItemType,
  SpeechJobStatus,
} from "@codeapt/shared";

const speakingItemSchema = new Schema(
  {
    itemType: {
      type: String,
      enum: SPEAKING_ITEM_TYPE_VALUES,
      default: SpeakingItemType.READ_ALOUD,
    },
    referenceText: { type: String, default: "" },
    promptText: { type: String, default: "" },
    promptAudioUrl: { type: String, default: "" },
    stimulusAudioUrl: { type: String, default: "" },
    stimulusPlayLimit: { type: Number, default: 0 },
    answerSet: { type: [String], default: [] },
    missingWord: { type: String, default: "" },
    keyFacts: { type: [String], default: [] },
    section: { type: String, default: "" },
    prepSeconds: { type: Number, default: 0 },
    responseWindowSeconds: { type: Number, default: 60 },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const speakingAssessmentSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    topic: { type: Schema.Types.ObjectId, ref: "Topic", default: null },
    orgUnits: { type: [Schema.Types.ObjectId], ref: "OrgUnit", default: [] },
    isPublished: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    items: { type: [speakingItemSchema], default: [] },
    maxAttempts: { type: Number, default: 1 },
  },
  { timestamps: true },
);
export type SpeakingAssessment = InferSchemaType<
  typeof speakingAssessmentSchema
>;
export const SpeakingAssessmentModel = model(
  "SpeakingAssessment",
  speakingAssessmentSchema,
);

const wordTimingSchema = new Schema(
  {
    word: { type: String, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
  },
  { _id: false },
);

const speakingAttemptItemSchema = new Schema(
  {
    itemIndex: { type: Number, required: true },
    audioUrl: { type: String, default: "" },
    jobId: { type: String, default: null },
    jobStatus: {
      type: String,
      enum: SPEECH_JOB_STATUS_VALUES,
      default: SpeechJobStatus.QUEUED,
    },
    transcript: { type: String, default: "" },
    wordTimings: { type: [wordTimingSchema], default: [] },
    subScores: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: "" },
  },
  { _id: false },
);

const speakingAttemptSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assessment: {
      type: Schema.Types.ObjectId,
      ref: "SpeakingAssessment",
      required: true,
    },
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    status: {
      type: String,
      enum: SPEAKING_ATTEMPT_STATUS_VALUES,
      default: SpeakingAttemptStatus.IN_PROGRESS,
    },
    items: { type: [speakingAttemptItemSchema], default: [] },
    currentIndex: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    startedAt: { type: Date },
    submittedAt: { type: Date },
    scoredAt: { type: Date },
  },
  { timestamps: true },
);
export type SpeakingAttempt = InferSchemaType<typeof speakingAttemptSchema>;
export const SpeakingAttemptModel = model(
  "SpeakingAttempt",
  speakingAttemptSchema,
);
