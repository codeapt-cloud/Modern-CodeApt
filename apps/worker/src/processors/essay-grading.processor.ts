/**
 * Essay-grading processor. Runs on the `default` queue (reserved for
 * miscellaneous async work) — deliberately SEPARATE from the code-execution
 * processor so the Piston pipeline is untouched.
 *
 * Lifecycle (idempotent + crash-safe, mirroring the code processor):
 *   1. Parse the {jobId, attemptId} payload; a malformed one is dropped.
 *   2. Load the ExecutionJob doc; skip if already finalized (retry / dup).
 *   3. Atomically flip queued → processing (job + attempt).
 *   4. Load the attempt + its topic; grade via `gradeEssay` (deterministic
 *      floor, AI blend when available).
 *   5. Write the sub-scores/final score/source/feedback onto the attempt and
 *      complete the job.
 * Grading NEVER rethrows into a worker crash: `gradeEssay` always returns a
 * result (deterministic fallback at worst), and any unexpected error finalizes
 * the job as failed.
 */
import { EssayStatus, JobStatus, essayGradingJobSchema } from "@codeapt/shared";
import type { Job, Processor } from "bullmq";

import { env } from "../config/env.js";
import { gradeEssay } from "../lib/essay-grader.js";
import { logger } from "../lib/logger.js";
import { EssayAttemptModel, EssayTopicModel } from "../models/essay.model.js";
import { ExecutionJobModel } from "../models/execution.model.js";

const FINALIZED: readonly JobStatus[] = [JobStatus.COMPLETED, JobStatus.FAILED];

/** BullMQ job name used to route essay grading onto the default queue. */
export const ESSAY_GRADING_JOB_NAME = "grade-essay";

export const essayGradingProcessor: Processor = async (
  job: Job,
): Promise<{ ok: boolean }> => {
  const parsed = essayGradingJobSchema.safeParse(job.data);
  if (!parsed.success) {
    logger.error(
      { jobId: job.id, issues: parsed.error.issues },
      "invalid essay-grading payload — dropping",
    );
    return { ok: false };
  }
  const { jobId, attemptId, aiEnabled, collegeId, userId } = parsed.data;
  const log = logger.child({ queue: "default", jobId, attemptId });

  const doc = await ExecutionJobModel.findOne({ jobId });
  if (!doc) {
    log.warn("ExecutionJob doc not found — nothing to update");
    return { ok: false };
  }
  if (FINALIZED.includes(doc.status as JobStatus)) {
    log.info({ status: doc.status }, "essay job already finalized — skipping");
    return { ok: true };
  }

  // Atomically claim the job.
  await ExecutionJobModel.updateOne(
    { jobId, status: { $nin: FINALIZED } },
    { $set: { status: JobStatus.PROCESSING, startedAt: new Date() } },
  );
  await EssayAttemptModel.updateOne(
    { _id: attemptId },
    {
      $set: {
        gradingStatus: JobStatus.PROCESSING,
        status: EssayStatus.UNDER_REVIEW,
      },
    },
  );
  log.info({ provider: env.ESSAY_AI_PROVIDER }, "processing essay");

  try {
    const attempt = await EssayAttemptModel.findById(attemptId);
    if (!attempt) {
      throw new Error(`EssayAttempt ${attemptId} not found`);
    }
    const topic = await EssayTopicModel.findById(attempt.essayTopic);
    if (!topic) {
      throw new Error(`EssayTopic ${String(attempt.essayTopic)} not found`);
    }

    const graded = await gradeEssay({
      essayText: attempt.content,
      prompt: `${topic.title}\n\n${topic.description}\n\n${topic.instructions}`,
      rubric:
        "Weighted dimensions: relevance 0.25, structure 0.23, vocabulary " +
        "0.22, grammar 0.12, readability 0.08, spelling 0.05, punctuation " +
        "0.05. Score vocabulary, structure, and relevance from 0 to 100.",
      referenceKeywords: topic.semanticKeywords,
      // Absent (older jobs) → AI allowed, preserving prior behavior.
      aiEnabled: aiEnabled ?? true,
      // Owning college (Stage-1 AI credits) — the seam charges this grade to it.
      collegeId,
      // Set only when the college runs per-student distribution → the seam meters
      // this grade against the STUDENT's own allocation instead of the pool.
      userId,
    });

    await ExecutionJobModel.updateOne(
      { jobId, status: { $nin: FINALIZED } },
      {
        $set: {
          status: JobStatus.COMPLETED,
          result: {
            total: graded.total,
            dimensions: graded.dimensions,
            source: graded.source,
            wordCount: graded.wordCount,
          },
          error: null,
          completedAt: new Date(),
        },
      },
    );

    // Persist the grade onto the attempt. Guarded so a duplicate delivery does
    // not overwrite an already-graded attempt.
    await EssayAttemptModel.updateOne(
      { _id: attemptId, gradingStatus: { $ne: JobStatus.COMPLETED } },
      {
        $set: {
          subScores: graded.dimensions,
          finalScore: graded.total,
          scoreSource: graded.source,
          feedback: graded.feedback,
          aiReport: {
            source: graded.source,
            feedback: graded.feedback,
            bonusApplied: graded.bonusApplied,
          },
          gradingStatus: JobStatus.COMPLETED,
          status: EssayStatus.GRADED,
          wordCount: graded.wordCount,
          gradedAt: new Date(),
        },
      },
    );

    log.info(
      { source: graded.source, total: graded.total },
      "essay grading completed",
    );
    return { ok: true };
  } catch (err) {
    log.error({ err }, "essay grading failed");
    await ExecutionJobModel.updateOne(
      { jobId, status: { $nin: FINALIZED } },
      {
        $set: {
          status: JobStatus.FAILED,
          error: "Essay grading failed unexpectedly.",
          completedAt: new Date(),
        },
      },
    );
    await EssayAttemptModel.updateOne(
      { _id: attemptId, gradingStatus: { $ne: JobStatus.COMPLETED } },
      { $set: { gradingStatus: JobStatus.FAILED } },
    );
    // Do NOT rethrow — a failed grade is a finalized job, not a worker crash.
    return { ok: false };
  }
};
