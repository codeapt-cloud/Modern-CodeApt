/**
 * ExecutionJob model (worker copy).
 *
 * The API creates the row (status "queued"); the worker moves it through
 * processing → completed/failed. Both apps map onto the SAME collection
 * (Mongoose pluralizes to `executionjobs`), so the schema mirrors the API's.
 * Kept minimal — the worker only reads status and writes result/status/error.
 */
import {
  JOB_STATUS_VALUES,
  JobStatus,
  QUEUE_NAME_VALUES,
} from "@codeapt/shared";
import { Schema, model, type InferSchemaType } from "mongoose";

const executionJobSchema = new Schema(
  {
    jobId: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    submissionRef: { type: String, default: "" },
    queue: { type: String, enum: QUEUE_NAME_VALUES, required: true },
    status: {
      type: String,
      enum: JOB_STATUS_VALUES,
      default: JobStatus.QUEUED,
    },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

export type ExecutionJob = InferSchemaType<typeof executionJobSchema>;
export const ExecutionJobModel = model("ExecutionJob", executionJobSchema);
