/**
 * Registers the automatic daily-challenge scheduler on the `default` queue:
 *   - a REPEATABLE BullMQ job at 00:01 IST (cron, tz Asia/Kolkata) that targets
 *     the IST day that has just begun — so a valid challenge is live for the new
 *     day. `upsertJobScheduler` is idempotent across redeploys (stable id).
 *   - a one-shot BOOT-ENSURE for TODAY so a fresh deploy/restart has today's
 *     challenge immediately without waiting for midnight. It is a no-op (no LLM
 *     cost) when the day is already published — the pipeline's date guard — and
 *     its stable jobId dedupes repeated restarts on the same day.
 *
 * Uses its OWN Redis connection (separate from the workers' blocking connection,
 * per BullMQ guidance). Returns a handle the entrypoint closes on shutdown.
 */
import {
  DAILY_CHALLENGE_CRON,
  DAILY_CHALLENGE_CRON_TZ,
  DAILY_CHALLENGE_JOB_NAME,
  QueueName,
  istDayKey,
} from "@codeapt/shared";
import { Queue } from "bullmq";

import { logger } from "../logger.js";
import { createRedisConnection } from "../redis.js";

export interface ScheduleHandle {
  close(): Promise<void>;
}

export async function registerDailyChallengeSchedule(): Promise<ScheduleHandle> {
  const connection = createRedisConnection();
  const queue = new Queue(QueueName.DEFAULT, { connection });

  try {
    await queue.upsertJobScheduler(
      "daily-challenge-generation",
      { pattern: DAILY_CHALLENGE_CRON, tz: DAILY_CHALLENGE_CRON_TZ },
      {
        name: DAILY_CHALLENGE_JOB_NAME,
        data: {},
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );

    const today = istDayKey(new Date());
    await queue.add(
      DAILY_CHALLENGE_JOB_NAME,
      {},
      {
        // BullMQ forbids ':' in a custom job id (its Redis key separator).
        jobId: `daily-ensure-${today}`,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    logger.info(
      { cron: DAILY_CHALLENGE_CRON, tz: DAILY_CHALLENGE_CRON_TZ, today },
      "daily-challenge scheduler registered (+ boot-ensure for today)",
    );
  } catch (err) {
    // Clean up our own queue/connection so a failed registration doesn't leak,
    // then rethrow — the caller keeps grading alive without the scheduler.
    await queue.close().catch(() => {});
    await connection.quit().catch(() => {});
    throw err;
  }

  return {
    async close(): Promise<void> {
      await queue.close();
      await connection.quit();
    },
  };
}
