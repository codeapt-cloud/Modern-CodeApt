/**
 * Speech transcription processor (Communication Sections A/B). Runs on the
 * dedicated, concurrency-capped `speech` queue. Same idempotent, crash-safe
 * shape as the code-execution + essay processors:
 *   1. Parse the {jobId, attemptId, itemIndex, audioUrl} payload; drop malformed.
 *   2. Load the ExecutionJob; skip if already finalized (retry / dup).
 *   3. Atomically claim queued → processing.
 *   4. Transcribe via the ASR client, score read-aloud (pure, from @codeapt/shared),
 *      and write the transcript + word timings + score onto the attempt item.
 *   5. On ANY error: finalize the item AND the job as FAILED and return — a
 *      failed transcription is a FINALIZED failed item, never a retry loop over
 *      student audio (attempts:1 on the producer reinforces this).
 */
import {
  SpeakingAttemptStatus,
  SpeechJobStatus,
  JobStatus,
  scoreReadAloud,
  speechJobSchema,
} from "@codeapt/shared";
import type { Job, Processor } from "bullmq";

import { AsrError, asrTranscribe } from "../lib/asr.js";
import { logger } from "../lib/logger.js";
import { ExecutionJobModel } from "../models/execution.model.js";
import {
  SpeakingAssessmentModel,
  SpeakingAttemptModel,
} from "../models/speaking.model.js";

const FINALIZED: readonly JobStatus[] = [JobStatus.COMPLETED, JobStatus.FAILED];

/** Mark one attempt item failed (guarded) + roll up the attempt if all done. */
async function finalizeItemFailed(
  attemptId: string,
  itemIndex: number,
  message: string,
): Promise<void> {
  await SpeakingAttemptModel.updateOne(
    { _id: attemptId },
    {
      $set: {
        [`items.${itemIndex}.jobStatus`]: SpeechJobStatus.FAILED,
        [`items.${itemIndex}.error`]: message,
      },
    },
  );
  await rollUpAttempt(attemptId);
}

/** Set the attempt to `scored` once every item is finalized (completed/failed). */
async function rollUpAttempt(attemptId: string): Promise<void> {
  const attempt = await SpeakingAttemptModel.findById(attemptId);
  if (!attempt) return;
  const allDone = attempt.items.every(
    (it) =>
      it.jobStatus === SpeechJobStatus.COMPLETED ||
      it.jobStatus === SpeechJobStatus.FAILED,
  );
  if (allDone && attempt.status !== SpeakingAttemptStatus.SCORED) {
    await SpeakingAttemptModel.updateOne(
      { _id: attemptId, status: { $ne: SpeakingAttemptStatus.SCORED } },
      { $set: { status: SpeakingAttemptStatus.SCORED, scoredAt: new Date() } },
    );
  }
}

export const speechProcessor: Processor = async (
  job: Job,
): Promise<{ ok: boolean }> => {
  const parsed = speechJobSchema.safeParse(job.data);
  if (!parsed.success) {
    logger.error(
      { jobId: job.id, issues: parsed.error.issues },
      "invalid speech payload — dropping",
    );
    return { ok: false };
  }
  const { jobId, attemptId, itemIndex, audioUrl } = parsed.data;
  const log = logger.child({ queue: "speech", jobId, attemptId, itemIndex });

  const doc = await ExecutionJobModel.findOne({ jobId });
  if (!doc) {
    log.warn("ExecutionJob doc not found — nothing to update");
    return { ok: false };
  }
  if (FINALIZED.includes(doc.status as JobStatus)) {
    log.info({ status: doc.status }, "speech job already finalized — skipping");
    return { ok: true };
  }

  await ExecutionJobModel.updateOne(
    { jobId, status: { $nin: FINALIZED } },
    { $set: { status: JobStatus.PROCESSING, startedAt: new Date() } },
  );
  await SpeakingAttemptModel.updateOne(
    { _id: attemptId },
    { $set: { [`items.${itemIndex}.jobStatus`]: SpeechJobStatus.PROCESSING } },
  );

  try {
    const attempt = await SpeakingAttemptModel.findById(attemptId);
    if (!attempt) throw new Error(`SpeakingAttempt ${attemptId} not found`);
    const assessment = await SpeakingAssessmentModel.findById(
      attempt.assessment,
    );
    const item = assessment?.items[itemIndex];
    if (!item) throw new Error(`Speaking item ${itemIndex} not found`);

    const asr = await asrTranscribe({ audioUrl });
    // Pure, deterministic scoring (WER + fluency) from @codeapt/shared.
    const score = scoreReadAloud(item.referenceText, asr.transcript, asr.words);

    // Persist onto the attempt item, guarded so a duplicate delivery cannot
    // overwrite a finalized item.
    await SpeakingAttemptModel.updateOne(
      {
        _id: attemptId,
        [`items.${itemIndex}.jobStatus`]: { $ne: SpeechJobStatus.COMPLETED },
      },
      {
        $set: {
          [`items.${itemIndex}.transcript`]: asr.transcript,
          [`items.${itemIndex}.wordTimings`]: asr.words,
          [`items.${itemIndex}.subScores`]: score,
          [`items.${itemIndex}.jobStatus`]: SpeechJobStatus.COMPLETED,
          [`items.${itemIndex}.error`]: "",
        },
      },
    );
    await ExecutionJobModel.updateOne(
      { jobId, status: { $nin: FINALIZED } },
      {
        $set: {
          status: JobStatus.COMPLETED,
          result: { wordAccuracy: score.wordAccuracy, wer: score.wer },
          error: null,
          completedAt: new Date(),
        },
      },
    );
    await rollUpAttempt(attemptId);
    log.info({ wordAccuracy: score.wordAccuracy }, "transcription scored");
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof AsrError ? err.message : "Transcription failed.";
    log.error({ err }, "speech transcription failed");
    await ExecutionJobModel.updateOne(
      { jobId, status: { $nin: FINALIZED } },
      { $set: { status: JobStatus.FAILED, error: message, completedAt: new Date() } },
    );
    await finalizeItemFailed(attemptId, itemIndex, message);
    // Do NOT rethrow — a failed transcription is a finalized failed item.
    return { ok: false };
  }
};
