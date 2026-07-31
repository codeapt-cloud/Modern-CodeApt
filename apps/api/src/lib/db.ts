/**
 * Mongoose connection helper + status reporting for the health endpoint.
 */
import mongoose from "mongoose";

import { env } from "../config/env.js";
import { logger } from "./logger.js";

export type DbStatus = "connected" | "disconnected" | "connecting" | "unknown";

/** Map Mongoose's numeric readyState to a human-readable status. */
export function getDbStatus(): DbStatus {
  switch (mongoose.connection.readyState) {
    case 1:
      return "connected";
    case 2:
      return "connecting";
    case 0:
      return "disconnected";
    default:
      return "unknown";
  }
}

let listenersBound = false;

function bindConnectionListeners(): void {
  if (listenersBound) return;
  listenersBound = true;

  mongoose.connection.on("connected", () => {
    logger.info("MongoDB connected");
  });
  mongoose.connection.on("error", (err: Error) => {
    logger.error({ err }, "MongoDB connection error");
  });
  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });
}

export async function connectDatabase(): Promise<void> {
  bindConnectionListeners();
  // Strict query keeps typos in filters from silently matching nothing.
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
