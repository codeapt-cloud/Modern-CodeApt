/**
 * Redis connection for BullMQ. BullMQ requires `maxRetriesPerRequest: null`
 * on the shared connection so blocking commands work correctly.
 */
import { Redis } from "ioredis";

import { env } from "../config/env.js";

export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
