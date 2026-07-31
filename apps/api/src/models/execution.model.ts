/**
 * ExecutionJob — async job tracker for the "fast response" architecture.
 *
 * The API creates a row (status "queued") and returns a jobId immediately;
 * the BullMQ worker updates it to processing → completed/failed. Clients poll
 * `GET /api/jobs/:id`. `submissionRef` points at whatever produced the job
 * (exam attempt, daily submission, playground run) — kept as a string so any
 * surface can enqueue without a hard FK.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  QUEUE_NAME_VALUES,
  JOB_STATUS_VALUES,
  JobStatus,
} from "@codeapt/shared";

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
executionJobSchema.index({ status: 1, queue: 1 });
executionJobSchema.index({ user: 1 });
export type ExecutionJob = InferSchemaType<typeof executionJobSchema>;
export const ExecutionJobModel = model("ExecutionJob", executionJobSchema);
