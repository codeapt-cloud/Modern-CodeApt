/**
 * API entrypoint: validate env, register models, connect to Mongo, start the
 * HTTP server, and wire graceful shutdown.
 */
import type { Server } from "node:http";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./lib/db.js";
import { closeQueues } from "./lib/execution-queue.js";
import { installLlmGateway, seedAiProviders } from "./lib/llm-gateway/index.js";
import { logger } from "./lib/logger.js";
import { autoSubmitExpiredExamAttempts } from "./services/exam.service.js";
// Importing the barrel registers every Mongoose model on boot.
import "./models/index.js";

/** How often the backstop sweeps for expired-but-unsubmitted exam attempts. */
const EXAM_SWEEP_INTERVAL_MS = 30_000;

async function bootstrap(): Promise<void> {
  await connectDatabase();

  // LLM gateway: seed the provider catalog (idempotent) + install the router
  // behind the callLlmChatJson seam so all AI features gain failover/monitoring.
  await seedAiProviders();
  installLlmGateway();

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`);
  });

  startExamAutoSubmitSweep();
  setupGracefulShutdown(server);
}

/**
 * Periodic backstop that finalizes exam attempts whose timer expired while the
 * taker was offline / had closed the tab (the online client auto-submits on its
 * own at 0). Lives in the API — not the worker — because it runs the real
 * grading/enqueue pipeline. An overlap guard prevents a slow sweep from stacking;
 * `unref()` keeps it from holding the process open at shutdown.
 */
function startExamAutoSubmitSweep(): void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void autoSubmitExpiredExamAttempts()
      .catch((err: unknown) =>
        logger.error({ err }, "exam auto-submit sweep failed"),
      )
      .finally(() => {
        running = false;
      });
  }, EXAM_SWEEP_INTERVAL_MS);
  timer.unref();
}

function setupGracefulShutdown(server: Server): void {
  const shutdown = (signal: string): void => {
    logger.info(`${signal} received — shutting down`);
    server.close(() => {
      void Promise.allSettled([disconnectDatabase(), closeQueues()]).finally(
        () => {
          logger.info("Shutdown complete");
          process.exit(0);
        },
      );
    });
    // Hard-exit if graceful shutdown stalls.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err: unknown) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
