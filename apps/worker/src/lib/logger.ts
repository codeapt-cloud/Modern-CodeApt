/**
 * Worker logger (pino). Pretty in dev, JSON in prod.
 */
import { pino } from "pino";

import { env, isDevelopment } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  name: "worker",
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
