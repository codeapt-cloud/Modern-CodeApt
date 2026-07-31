/**
 * HTTP request logging via pino-http. Attaches a child logger to `req.log`.
 */
import { pinoHttp } from "pino-http";

import { logger } from "../lib/logger.js";

export const requestLogger = pinoHttp({
  logger,
  // Quiet health checks at info level; they run constantly.
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    if (req.url === "/api/health") return "debug";
    return "info";
  },
});
