/**
 * Execution service — the fast submit path and the status read path.
 *
 * Submit does the minimum synchronous work: create an ExecutionJob doc
 * (status=queued) and enqueue a BullMQ job, then return a JobRef. The worker
 * owns everything after that (Piston + grading + finalizing the doc). Status
 * reads enforce that a job belongs to the requesting user.
 */
import { randomUUID } from "node:crypto";

import {
  ExecutionErrorCode,
  JobStatus,
  PURPOSE_QUEUE,
  type CodeExecutionJob,
  type ExecuteRequest,
  type ExecuteStatusResponse,
  type ExecutionResult,
  type JobRef,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { enqueueCodeJob } from "../lib/execution-queue.js";
import {
  ExecutionJobModel,
  type ExecutionJob,
} from "../models/execution.model.js";

/** Lean shape including the timestamps Mongoose adds but doesn't infer. */
type ExecutionJobLean = ExecutionJob & {
  createdAt: Date;
  updatedAt: Date;
};

/** Create the job row + enqueue it. Returns fast; never touches Piston. */
export async function submitExecution(
  userId: string,
  input: ExecuteRequest,
): Promise<JobRef> {
  const jobId = randomUUID();
  const queue = PURPOSE_QUEUE[input.purpose];

  await ExecutionJobModel.create({
    jobId,
    user: new Types.ObjectId(userId),
    submissionRef: input.purpose,
    queue,
    status: JobStatus.QUEUED,
  });

  const payload: CodeExecutionJob = {
    jobId,
    submissionRef: input.purpose,
    language: input.language,
    source: input.source,
    ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
    ...(input.testCases ? { testCases: input.testCases } : {}),
  };
  await enqueueCodeJob(queue, payload);

  return { jobId, status: JobStatus.QUEUED };
}

/** Read a job's status/result, enforcing ownership. */
export async function getJobStatus(
  userId: string,
  jobId: string,
): Promise<ExecuteStatusResponse> {
  const job = await ExecutionJobModel.findOne({
    jobId,
  }).lean<ExecutionJobLean | null>();
  if (!job) {
    throw new AppError("Job not found", 404, ExecutionErrorCode.JOB_NOT_FOUND);
  }
  // A job with no owner is unreachable via this authed route; owned jobs must
  // match the caller.
  if (!job.user || job.user.toString() !== userId) {
    throw new AppError(
      "You do not have access to this job",
      403,
      ExecutionErrorCode.JOB_FORBIDDEN,
    );
  }

  return {
    jobId: job.jobId,
    status: job.status as JobStatus,
    result: (job.result as ExecutionResult | null) ?? null,
    error: job.error ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
