/**
 * Speaking (Communication Sections A/B — the speech spine). Mirrors the tenancy
 * shapes of GameSet/Exam: a SpeakingAssessment is one of three shapes —
 *   - tenant-authored  (college set, topic null),
 *   - course-attached  (college null, topic set),
 *   - platform-internal (college null, topic null) —
 * with org-unit targeting + a draft→publish gate, exactly like gaming. Step 10
 * shipped ONE item type (read_aloud); Step 12 adds the rest. items[] + the
 * embedded score (Mixed) were shaped to extend without a migration — per-type
 * required fields are enforced at the zod (schema) layer, so the mongoose item
 * keeps every content field optional.
 *
 * Audio is student PII: SpeakingAttempt.items[].audioUrl is a hosted Cloudinary
 * URL. Retention position (documented, enforced by ops + the delete path): audio
 * is kept only as long as the attempt it belongs to; deleting an assessment or
 * an attempt is the college's to do and removes the reference. See the service.
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

// --- Authored item (embedded on the assessment) -----------------------------
const speakingItemSchema = new Schema(
  {
    itemType: {
      type: String,
      enum: SPEAKING_ITEM_TYPE_VALUES,
      default: SpeakingItemType.READ_ALOUD,
    },
    // WER / typed reference (read_aloud shows it on screen; other reference
    // types hear it). Optional at the model layer — the zod schema enforces
    // which item types actually require it.
    referenceText: { type: String, default: "" },
    promptText: { type: String, default: "" },
    // TTS-generated spoken prompt (Cloudinary URL), produced at authoring time.
    promptAudioUrl: { type: String, default: "" },
    // TTS provenance — the fixed Piper voice + version that produced promptAudioUrl,
    // pinned so a regenerate can't silently change the sound. Empty for a manually
    // uploaded clip (playback uses promptAudioUrl alone — no downstream difference).
    promptAudioVoiceId: { type: String, default: "" },
    promptAudioVoiceVersion: { type: String, default: "" },
    // Listening stimulus audio (conversation / passage_question / story_retell).
    stimulusAudioUrl: { type: String, default: "" },
    // Authoring-only source text for the stimulus "Generate audio" (withheld from
    // the student view) + its TTS provenance — mirrors promptAudio*.
    stimulusText: { type: String, default: "" },
    stimulusAudioVoiceId: { type: String, default: "" },
    stimulusAudioVoiceVersion: { type: String, default: "" },
    stimulusPlayLimit: { type: Number, default: 0, min: 0 },
    // Acceptable answers (short_answer / conversation / passage_question).
    answerSet: { type: [String], default: [] },
    // The blanked word (fill_missing_word).
    missingWord: { type: String, default: "" },
    // Authored key facts a retell should cover (story_retell).
    keyFacts: { type: [String], default: [] },
    // Preset-composition grouping label (e.g. "Section B").
    section: { type: String, default: "" },
    // Client-side prep countdown before recording (open_topic/role_play); 0 = none.
    prepSeconds: { type: Number, default: 0, min: 0, max: 300 },
    responseWindowSeconds: { type: Number, default: 60, min: 1, max: 300 },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

// --- SpeakingAssessment ------------------------------------------------------
const speakingAssessmentSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    topic: { type: Schema.Types.ObjectId, ref: "Topic", default: null },
    orgUnits: { type: [Schema.Types.ObjectId], ref: "OrgUnit", default: [] },
    isPublished: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    items: { type: [speakingItemSchema], default: [] },
    // Attempt cap; 0 = unlimited.
    maxAttempts: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true },
);
speakingAssessmentSchema.index({ college: 1 });
speakingAssessmentSchema.index({ topic: 1 });
export type SpeakingAssessment = InferSchemaType<
  typeof speakingAssessmentSchema
>;
export const SpeakingAssessmentModel = model(
  "SpeakingAssessment",
  speakingAssessmentSchema,
);

// --- Per-item recorded response + its transcription/score --------------------
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
    itemIndex: { type: Number, required: true, min: 0 },
    // Only the hosted URL is stored — the audio never transits the API.
    audioUrl: { type: String, default: "" },
    jobId: { type: String, default: null },
    jobStatus: {
      type: String,
      enum: SPEECH_JOB_STATUS_VALUES,
      default: SpeechJobStatus.QUEUED,
    },
    transcript: { type: String, default: "" },
    wordTimings: { type: [wordTimingSchema], default: [] },
    // The computed ReadAloudScore (wordAccuracy, wer, missed/missaid/extra,
    // fluency). Mixed so Step 11's item scores can extend it.
    subScores: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: "" },
  },
  { _id: false },
);

// --- SpeakingAttempt ---------------------------------------------------------
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
    // Progressive disclosure: the item currently disclosed to the student. The
    // in-progress read returns only this item, never the whole list.
    currentIndex: { type: Number, default: 0, min: 0 },
    // Server-authoritative deadline stamped at start (= start + summed item
    // budgets). Reads/writes past it are refused; the reaper sweeps it.
    expiresAt: { type: Date, default: null },
    startedAt: { type: Date },
    submittedAt: { type: Date },
    scoredAt: { type: Date },
  },
  { timestamps: true },
);
speakingAttemptSchema.index({ user: 1, assessment: 1 });
// Reaper scan: stale in-progress attempts by deadline.
speakingAttemptSchema.index({ status: 1, expiresAt: 1 });
export type SpeakingAttempt = InferSchemaType<typeof speakingAttemptSchema>;
export const SpeakingAttemptModel = model(
  "SpeakingAttempt",
  speakingAttemptSchema,
);
