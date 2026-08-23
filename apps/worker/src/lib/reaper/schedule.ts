/**
 * Registers the shared ATTEMPT REAPER as a repeatable BullMQ job on the `default`
 * queue (every 15 min, tz Asia/Kolkata). `upsertJobScheduler` is idempotent
 * across redeploys (stable id); own Redis connection per BullMQ guidance; returns
 * a handle the entrypoint closes on shutdown. Auxiliary — registration failure
 * must never take down core grading (guarded at the call site).
 */
import {
  ATTEMPT_REAPER_CRON,
  ATTEMPT_REAPER_CRON_TZ,
  ATTEMPT_REAPER_JOB_NAME,
  QueueName,
} from "@codeapt/shared";
import { Queue } from "bullmq";

import { logger } from "../logger.js";
import { createRedisConnection } from "../redis.js";

export interface ScheduleHandle {
  close(): Promise<void>;
}

export async function registerAttemptReaperSchedule(): Promise<ScheduleHandle> {
  const connection = createRedisConnection();
  const queue = new Queue(QueueName.DEFAULT, { connection });

  try {
    await queue.upsertJobScheduler(
      "attempt-reaper",
      { pattern: ATTEMPT_REAPER_CRON, tz: ATTEMPT_REAPER_CRON_TZ },
      {
        name: ATTEMPT_REAPER_JOB_NAME,
        data: {},
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );
    logger.info(
      { cron: ATTEMPT_REAPER_CRON, tz: ATTEMPT_REAPER_CRON_TZ },
      "attempt reaper scheduler registered",
    );
  } catch (err) {
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
