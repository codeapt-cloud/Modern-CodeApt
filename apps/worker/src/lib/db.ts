/**
 * MongoDB connection for the worker. The worker owns the write side of an
 * ExecutionJob's lifecycle (processing → completed/failed), so it needs its own
 * Mongoose connection to the same database the API writes the initial doc to.
 */
import mongoose from "mongoose";

import { env } from "../config/env.js";
import { logger } from "./logger.js";

export async function connectDb(): Promise<void> {
  mongoose.connection.on("connected", () => logger.info("MongoDB connected"));
  mongoose.connection.on("error", (err: Error) =>
    logger.error({ err }, "MongoDB connection error"),
  );
  mongoose.connection.on("disconnected", () =>
    logger.warn("MongoDB disconnected"),
  );
  await mongoose.connect(env.MONGODB_URI);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
