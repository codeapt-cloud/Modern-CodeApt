/**
 * Registers the daily coding-profile SWEEP on the `default` queue: a REPEATABLE
 * BullMQ job at 02:10 IST (cron, tz Asia/Kolkata). The sweep itself (see the
 * processor) fans out one refresh job PER linked student onto the rate-limited
 * `coding-refresh` queue, so the outbound calls are paced.
 *
 * `upsertJobScheduler` is idempotent across redeploys (stable id). Uses its OWN
 * Redis connection (per BullMQ guidance) and returns a handle the entrypoint
 * closes on shutdown. Deliberately NO boot-ensure — we don't want a full sweep
 * to fire on every deploy/restart; the daily cron is sufficient.
 */
import {
  CODING_REFRESH_CRON,
  CODING_REFRESH_CRON_TZ,
  CODING_REFRESH_SWEEP_JOB_NAME,
  QueueName,
} from "@codeapt/shared";
import { Queue } from "bullmq";

import { logger } from "../logger.js";
import { createRedisConnection } from "../redis.js";

export interface ScheduleHandle {
  close(): Promise<void>;
}

export async function registerCodingRefreshSchedule(): Promise<ScheduleHandle> {
  const connection = createRedisConnection();
  const queue = new Queue(QueueName.DEFAULT, { connection });

  try {
    await queue.upsertJobScheduler(
      "coding-refresh-sweep",
      { pattern: CODING_REFRESH_CRON, tz: CODING_REFRESH_CRON_TZ },
      {
        name: CODING_REFRESH_SWEEP_JOB_NAME,
        data: {},
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );
    logger.info(
      { cron: CODING_REFRESH_CRON, tz: CODING_REFRESH_CRON_TZ },
      "coding-refresh sweep scheduler registered",
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
