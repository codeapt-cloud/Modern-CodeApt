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
// Importing the barrel registers every Mongoose model on boot.
import "./models/index.js";

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

  setupGracefulShutdown(server);
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
