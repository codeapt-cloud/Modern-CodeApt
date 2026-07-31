/**
 * Application logger (pino). Pretty-prints in development, JSON in production.
 */
import { pino } from "pino";

import { env, isDevelopment } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }
    : {}),
});

export type Logger = typeof logger;
