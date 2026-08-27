/**
 * The shared ATTEMPT REAPER — one periodic sweep that finalizes abandoned
 * in-progress attempts across BOTH modules (Step 3 deferred this for games;
 * done here once for both):
 *   - SpeakingAttempt: still has an undisclosed item AND its server deadline has
 *     passed → status EXPIRED. (An attempt whose items are all answered is left
 *     alone — only async SCORING remains, which the deadline must not disturb.)
 *   - GameSetAttempt: IN_PROGRESS and untouched for longer than the abandon
 *     grace (updatedAt is bumped on every answer, so active play is safe) →
 *     status ABANDONED.
 * Idempotent: only stale rows match, and re-running re-matches nothing new. Rides
 * the `default` queue, name-dispatched, exactly like the coding-refresh sweep.
 */
import {
  GAME_ATTEMPT_ABANDON_GRACE_MS,
  GameSetAttemptStatus,
  MockInterviewStatus,
  SPEAKING_SUBMIT_GRACE_MS,
  SpeakingAttemptStatus,
} from "@codeapt/shared";
import type { Job } from "bullmq";

import { logger } from "../lib/logger.js";
import { GameSetAttemptModel } from "../models/game.model.js";
import { MockInterviewAttemptModel } from "../models/mock-interview.model.js";
import { SpeakingAttemptModel } from "../models/speaking.model.js";

// A mock interview shares speaking's submit grace (both stamp a server deadline).
const INTERVIEW_SUBMIT_GRACE_MS = SPEAKING_SUBMIT_GRACE_MS;

export const ATTEMPT_REAPER_JOB_NAME = "attempt-reaper";

/** True when a speaking attempt is a reap candidate: past the deadline + the
 *  submit grace (so it can't pre-empt an in-flight within-grace answer) with at
 *  least one item still undisclosed. Pure so it can be unit-tested without Mongo. */
export function shouldReapSpeaking(
  attempt: {
    status: string;
    expiresAt: Date | null;
    currentIndex: number;
    itemCount: number;
  },
  now: Date,
): boolean {
  return (
    (attempt.status === SpeakingAttemptStatus.IN_PROGRESS ||
      attempt.status === SpeakingAttemptStatus.SUBMITTED) &&
    !!attempt.expiresAt &&
    now.getTime() > attempt.expiresAt.getTime() + SPEAKING_SUBMIT_GRACE_MS &&
    attempt.currentIndex < attempt.itemCount
  );
}

/** True when a mock-interview attempt is a reap candidate — past the deadline +
 *  grace with at least one turn still undisclosed. Pure (mirrors shouldReapSpeaking). */
export function shouldReapInterview(
  attempt: {
    status: string;
    expiresAt: Date | null;
    currentIndex: number;
    turnCount: number;
  },
  now: Date,
): boolean {
  return (
    (attempt.status === MockInterviewStatus.IN_PROGRESS ||
      attempt.status === MockInterviewStatus.SUBMITTED) &&
    !!attempt.expiresAt &&
    now.getTime() > attempt.expiresAt.getTime() + INTERVIEW_SUBMIT_GRACE_MS &&
    attempt.currentIndex < attempt.turnCount
  );
}

export async function reapAttempts(now: Date = new Date()): Promise<{
  speakingExpired: number;
  gamesAbandoned: number;
  interviewsExpired: number;
}> {
  // --- Speaking: past-deadline attempts with undisclosed items. ---
  const graceCutoff = new Date(now.getTime() - SPEAKING_SUBMIT_GRACE_MS);
  const candidates = await SpeakingAttemptModel.find({
    status: {
      $in: [SpeakingAttemptStatus.IN_PROGRESS, SpeakingAttemptStatus.SUBMITTED],
    },
    expiresAt: { $ne: null, $lt: graceCutoff },
  }).select("status expiresAt currentIndex items");
  const stale = candidates.filter((a) =>
    shouldReapSpeaking(
      {
        status: a.status,
        expiresAt: a.expiresAt ?? null,
        currentIndex: a.currentIndex ?? 0,
        itemCount: a.items.length,
      },
      now,
    ),
  );
  let speakingExpired = 0;
  if (stale.length > 0) {
    const res = await SpeakingAttemptModel.updateMany(
      { _id: { $in: stale.map((a) => a._id) } },
      { $set: { status: SpeakingAttemptStatus.EXPIRED, scoredAt: now } },
    );
    speakingExpired = res.modifiedCount ?? 0;
  }

  // --- Games: in-progress attempts untouched past the abandon grace. ---
  const cutoff = new Date(now.getTime() - GAME_ATTEMPT_ABANDON_GRACE_MS);
  const games = await GameSetAttemptModel.updateMany(
    { status: GameSetAttemptStatus.IN_PROGRESS, updatedAt: { $lt: cutoff } },
    { $set: { status: GameSetAttemptStatus.ABANDONED, completedAt: now } },
  );
  const gamesAbandoned = games.modifiedCount ?? 0;

  // --- Mock interviews: past-deadline attempts with undisclosed turns. Backstop
  //     only — the API scores inline + lazily finalizes on read. ---
  const interviewCandidates = await MockInterviewAttemptModel.find({
    status: {
      $in: [MockInterviewStatus.IN_PROGRESS, MockInterviewStatus.SUBMITTED],
    },
    expiresAt: { $ne: null, $lt: graceCutoff },
  }).select("status expiresAt currentIndex turns");
  const staleInterviews = interviewCandidates.filter((a) =>
    shouldReapInterview(
      {
        status: a.status as string,
        expiresAt: (a.expiresAt as Date | null) ?? null,
        currentIndex: (a.currentIndex as number) ?? 0,
        turnCount: Array.isArray(a.turns) ? a.turns.length : 0,
      },
      now,
    ),
  );
  let interviewsExpired = 0;
  if (staleInterviews.length > 0) {
    const res = await MockInterviewAttemptModel.updateMany(
      { _id: { $in: staleInterviews.map((a) => a._id) } },
      { $set: { status: MockInterviewStatus.EXPIRED, scoredAt: now } },
    );
    interviewsExpired = res.modifiedCount ?? 0;
  }

  if (speakingExpired > 0 || gamesAbandoned > 0 || interviewsExpired > 0) {
    logger.info(
      { speakingExpired, gamesAbandoned, interviewsExpired },
      "attempt reaper swept",
    );
  }
  return { speakingExpired, gamesAbandoned, interviewsExpired };
}

export async function attemptReaperProcessor(job: Job): Promise<{ ok: true }> {
  const log = logger.child({ queue: "default", jobId: job.id, name: job.name });
  try {
    const { speakingExpired, gamesAbandoned, interviewsExpired } =
      await reapAttempts(new Date());
    log.info(
      { speakingExpired, gamesAbandoned, interviewsExpired },
      "attempt reaper done",
    );
  } catch (err) {
    // Auxiliary — never let a reaper failure crash the worker.
    log.error({ err }, "attempt reaper failed");
  }
  return { ok: true };
}
