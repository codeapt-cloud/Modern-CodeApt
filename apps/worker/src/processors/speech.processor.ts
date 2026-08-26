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
  SpeakingItemType,
  SpeechEngine,
  SpeechJobStatus,
  JobStatus,
  matchAnswerSet,
  scoreFillMissingWord,
  scoreReadAloud,
  speechJobSchema,
  type WordTiming,
} from "@codeapt/shared";
import type { Job, Processor } from "bullmq";

import { AsrError, asrTranscribe } from "../lib/asr.js";
import { logger } from "../lib/logger.js";
import { gradeOpenTopic, gradeStoryRetell } from "../lib/speech-grader.js";
import { ExecutionJobModel } from "../models/execution.model.js";
import {
  SpeakingAssessmentModel,
  SpeakingAttemptModel,
} from "../models/speaking.model.js";

/** A stored speech item score — the union across item types is opaque here. */
type SpeechScore = Record<string, unknown>;

/** A single numeric headline for the ExecutionJob result summary, per type. */
function scoreHeadline(score: SpeechScore): number {
  for (const key of ["wordAccuracy", "score", "total"] as const) {
    const v = score[key];
    if (typeof v === "number") return v;
  }
  return 0;
}

/**
 * Dispatch an item to its scorer. Reference-known spoken types reuse the
 * phonetic-tolerant WER; answer-set types use the fuzzy+phonetic matcher; the
 * two hybrid (LLM) types compute a deterministic floor and optionally blend an
 * AI judgement (never phonetic). Dictation never reaches here — it is scored
 * inline at submit (typed, no ASR).
 */
async function scoreSpeechItem(
  item: {
    itemType: string;
    referenceText: string;
    promptText: string;
    missingWord: string;
    answerSet: string[];
    keyFacts: string[];
  },
  transcript: string,
  words: readonly WordTiming[],
  ctx: { collegeId?: string; userId?: string },
): Promise<SpeechScore> {
  switch (item.itemType) {
    case SpeakingItemType.SHORT_ANSWER:
    case SpeakingItemType.CONVERSATION:
    case SpeakingItemType.PASSAGE_QUESTION:
      return matchAnswerSet(
        transcript,
        item.answerSet,
      ) as unknown as SpeechScore;
    case SpeakingItemType.FILL_MISSING_WORD:
      return scoreFillMissingWord(
        item.referenceText,
        item.missingWord,
        transcript,
        words,
      ) as unknown as SpeechScore;
    case SpeakingItemType.STORY_RETELL:
      return (await gradeStoryRetell({
        keyFacts: item.keyFacts,
        transcript,
        wordTimings: words,
        collegeId: ctx.collegeId,
        userId: ctx.userId,
      })) as unknown as SpeechScore;
    case SpeakingItemType.OPEN_TOPIC:
      return (await gradeOpenTopic({
        promptText: item.promptText,
        transcript,
        wordTimings: words,
        collegeId: ctx.collegeId,
        userId: ctx.userId,
      })) as unknown as SpeechScore;
    case SpeakingItemType.DICTATION:
      throw new Error("dictation is scored inline at submit, not via ASR");
    // read_aloud, repeat, sentence_build, error_correct — all word accuracy.
    default:
      return scoreReadAloud(
        item.referenceText,
        transcript,
        words,
      ) as unknown as SpeechScore;
  }
}

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
  const { jobId, attemptId, itemIndex, audioUrl, collegeId, userId } =
    parsed.data;
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
    // Dispatch to the item type's scorer (pure for the deterministic types; a
    // deterministic floor + optional AI blend for story_retell / open_topic).
    const score = await scoreSpeechItem(
      {
        itemType: item.itemType,
        referenceText: item.referenceText ?? "",
        promptText: item.promptText ?? "",
        missingWord: item.missingWord ?? "",
        answerSet: item.answerSet ?? [],
        keyFacts: item.keyFacts ?? [],
      },
      asr.transcript,
      asr.words,
      { collegeId, userId },
    );
    const headline = scoreHeadline(score as SpeechScore);

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
          // Step 32: the Whisper path (initial score OR a tier-2 re-score of a
          // browser attempt) attributes the item to whisper.
          [`items.${itemIndex}.engine`]: SpeechEngine.WHISPER,
        },
      },
    );
    await ExecutionJobModel.updateOne(
      { jobId, status: { $nin: FINALIZED } },
      {
        $set: {
          status: JobStatus.COMPLETED,
          result: { itemType: item.itemType, score: headline },
          error: null,
          completedAt: new Date(),
        },
      },
    );
    await rollUpAttempt(attemptId);
    log.info({ itemType: item.itemType, score: headline }, "speech item scored");
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
