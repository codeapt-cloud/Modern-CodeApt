/**
 * Worker entrypoint: connect to MongoDB + Redis and register one BullMQ Worker
 * per queue (default / practice / assessment / playground). The code-execution
 * processors read/write ExecutionJob docs, so the DB connection is established
 * before any worker starts. Wires graceful shutdown so in-flight jobs finish
 * cleanly.
 */
import {
  AI_PACED_MAX_PER_MINUTE,
  QUEUE_CONFIGS,
  QUEUE_NAME_VALUES,
  QueueName,
} from "@codeapt/shared";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";

import { env } from "./config/env.js";
import { connectDb, disconnectDb } from "./lib/db.js";
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

function start(connection: Redis): Worker[] {
  const workers = QUEUE_NAME_VALUES.map((queue) => {
    const config = QUEUE_CONFIGS[queue];
    // The paced-AI queue (Stage-2 governor) is RATE-LIMITED so the deferred
    // backlog drains within provider minute-limits and never rate-limits
    // everyone. Other queues run at full concurrency.
    const isPaced = queue === QueueName.AI_PACED;
    const worker = new Worker(queue, processors[queue], {
      connection,
      concurrency: env.WORKER_CONCURRENCY,
      // Lock as long as the queue's timeout: a job that outlives this (a wedged
      // execution) is treated as stalled and reclaimed rather than stuck.
      lockDuration: config.timeoutSeconds * 1000,
      ...(isPaced
        ? { limiter: { max: AI_PACED_MAX_PER_MINUTE, duration: 60_000 } }
        : {}),
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

  setupGracefulShutdown(workers, connection, schedule);
}

function setupGracefulShutdown(
  workers: Worker[],
  connection: Redis,
  schedule: ScheduleHandle | null,
): void {
  const shutdown = (signal: string): void => {
    logger.info(`${signal} received — closing workers`);
    Promise.allSettled(workers.map((w) => w.close()))
      .then(() => schedule?.close())
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
