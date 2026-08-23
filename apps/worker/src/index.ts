/**
 * Worker entrypoint: connect to MongoDB + Redis and register one BullMQ Worker
 * per queue (default / practice / assessment / playground). The code-execution
 * processors read/write ExecutionJob docs, so the DB connection is established
 * before any worker starts. Wires graceful shutdown so in-flight jobs finish
 * cleanly.
 */
import {
  AI_PACED_MAX_PER_MINUTE,
  CODING_REFRESH_MAX_PER_MINUTE,
  QUEUE_CONFIGS,
  QUEUE_NAME_VALUES,
  QueueName,
  SPEECH_MAX_PER_MINUTE,
} from "@codeapt/shared";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";

import { env } from "./config/env.js";
import { connectDb, disconnectDb } from "./lib/db.js";
import { registerCodingRefreshSchedule } from "./lib/coding-refresh/schedule.js";
import { registerDailyChallengeSchedule } from "./lib/daily-challenge/schedule.js";
import type { ScheduleHandle } from "./lib/daily-challenge/schedule.js";
import { installLlmGateway } from "./lib/llm-gateway/index.js";
import { createRedisConnection } from "./lib/redis.js";
import { logger } from "./lib/logger.js";
import { processors } from "./processors/index.js";
// Register the gateway models on the worker's Mongoose connection.
import "./models/ai-provider.model.js";
import "./models/ai-usage.model.js";
import "./models/ai-governor.model.js";
// Register the coding-profile model (read by the sweep + student refresh).
import "./models/coding-profile.model.js";
// Register the per-student AI credit ledger (metered at the gateway seam).
import "./models/student-ai-credit.model.js";
// Register the speaking models (read + written by the speech processor).
import "./models/speaking.model.js";

/** Per-queue BullMQ rate limiter (paced drains); other queues run unlimited. */
function limiterFor(queue: QueueName): { max: number; duration: number } | null {
  if (queue === QueueName.AI_PACED) {
    return { max: AI_PACED_MAX_PER_MINUTE, duration: 60_000 };
  }
  if (queue === QueueName.CODING_REFRESH) {
    return { max: CODING_REFRESH_MAX_PER_MINUTE, duration: 60_000 };
  }
  if (queue === QueueName.SPEECH) {
    // Burst guard beside the concurrency cap: ASR is CPU-heavy, so a stampede
    // of submissions can't peg the shared box (see the queue arithmetic).
    return { max: SPEECH_MAX_PER_MINUTE, duration: 60_000 };
  }
  return null;
}

function start(connection: Redis): Worker[] {
  const workers = QUEUE_NAME_VALUES.map((queue) => {
    const config = QUEUE_CONFIGS[queue];
    // The paced-AI + coding-refresh queues are RATE-LIMITED so their backlogs
    // drain within external minute-limits and never burst. Other queues run at
    // full concurrency.
    const limiter = limiterFor(queue);
    const worker = new Worker(queue, processors[queue], {
      connection,
      // Per-queue override (the speech queue caps simultaneous ASR requests so
      // transcription can't monopolise the box); otherwise WORKER_CONCURRENCY.
      concurrency: config.concurrency ?? env.WORKER_CONCURRENCY,
      // Lock as long as the queue's timeout: a job that outlives this (a wedged
      // execution) is treated as stalled and reclaimed rather than stuck.
      lockDuration: config.timeoutSeconds * 1000,
      ...(limiter ? { limiter } : {}),
    });

    worker.on("completed", (job) =>
      logger.debug({ queue, jobId: job.id }, "job completed"),
    );
    worker.on("failed", (job, err) =>
      logger.error({ queue, jobId: job?.id, err }, "job failed"),
    );

    logger.info(
      {
        queue,
        timeoutSeconds: config.timeoutSeconds,
        priority: config.priority,
      },
      `Registered worker for "${queue}" queue`,
    );
    return worker;
  });

  logger.info(`Worker up — listening on ${workers.length} queues`);
  return workers;
}

async function bootstrap(): Promise<void> {
  await connectDb();
  // Route essay grading + daily-challenge generation through the multi-provider
  // gateway (if ENCRYPTION_KEY is set); otherwise the essay grader keeps its
  // single-provider fallback and the daily-challenge pipeline uses its bank/
  // curated fallback (no AI).
  installLlmGateway();

  const connection = createRedisConnection();
  connection.on("connect", () => logger.info("Redis connected"));
  connection.on("error", (err: Error) =>
    logger.error({ err }, "Redis connection error"),
  );

  const workers = start(connection);

  // Automatic daily-challenge generation (IST cron + boot-ensure). This is an
  // AUXILIARY feature — it must NEVER be able to take down core grading. If the
  // scheduler can't register (Redis hiccup, etc.), log and continue: the queue
  // workers are already live and keep processing essay/code jobs.
  let schedule: ScheduleHandle | null = null;
  try {
    schedule = await registerDailyChallengeSchedule();
  } catch (err) {
    logger.error(
      { err },
      "daily-challenge scheduler failed to register — grading continues without it",
    );
  }

  // Daily coding-profile sweep — also AUXILIARY and independently guarded, so a
  // failure here can't take down grading OR the daily-challenge scheduler.
  let codingSchedule: ScheduleHandle | null = null;
  try {
    codingSchedule = await registerCodingRefreshSchedule();
  } catch (err) {
    logger.error(
      { err },
      "coding-refresh scheduler failed to register — grading continues without it",
    );
  }

  setupGracefulShutdown(workers, connection, [schedule, codingSchedule]);
}

function setupGracefulShutdown(
  workers: Worker[],
  connection: Redis,
  schedules: (ScheduleHandle | null)[],
): void {
  const shutdown = (signal: string): void => {
    logger.info(`${signal} received — closing workers`);
    Promise.allSettled(workers.map((w) => w.close()))
      .then(() =>
        Promise.allSettled(schedules.map((s) => s?.close() ?? Promise.resolve())),
      )
      .then(() => connection.quit())
      .then(() => disconnectDb())
      .finally(() => {
        logger.info("Worker shutdown complete");
        process.exit(0);
      });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err: unknown) => {
  logger.error({ err }, "worker failed to start");
  process.exit(1);
});
