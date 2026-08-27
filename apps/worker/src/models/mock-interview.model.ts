/**
 * Mock-interview attempt (worker copy — reaper only). Maps onto the SAME
 * `mockinterviewattempts` collection the API writes; only the fields the reaper
 * needs are declared. The API owns the full schema + indexes. An interview is
 * scored INLINE by the API, so the reaper is just a backstop that flips an
 * abandoned, past-deadline attempt to EXPIRED (the API's lazy finalize computes
 * the partial report whenever such an attempt is next read).
 */
import { Schema, model } from "mongoose";
import { MOCK_INTERVIEW_STATUS_VALUES, MockInterviewStatus } from "@codeapt/shared";

const mockInterviewAttemptSchema = new Schema(
  {
    status: {
      type: String,
      enum: MOCK_INTERVIEW_STATUS_VALUES,
      default: MockInterviewStatus.IN_PROGRESS,
    },
    currentIndex: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    scoredAt: { type: Date },
    turns: { type: [new Schema({}, { _id: false, strict: false })], default: [] },
  },
  { timestamps: true, strict: false },
);

export const MockInterviewAttemptModel = model(
  "MockInterviewAttempt",
  mockInterviewAttemptSchema,
);
