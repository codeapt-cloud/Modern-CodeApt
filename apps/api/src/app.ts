/**
 * Express application factory. Assembles middleware and routes; kept free of
 * process/lifecycle concerns (those live in index.ts) so it stays testable.
 */
import { API_PREFIX } from "@codeapt/shared";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { apiRouter } from "./routes/index.js";

export function createApp(): Express {
  const app = express();

  // Behind a proxy (App Runner / Render / Fly) — trust it for correct IPs.
  app.set("trust proxy", 1);

  // Security headers.
  app.use(helmet());

  // CORS — allow the SPA origin(s); credentials for cookie-based auth later.
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
      credentials: true,
    }),
  );

  // Body + cookie parsing. Capture the RAW body so the payments webhook can
  // verify a gateway signature over the exact bytes (not a re-serialized JSON).
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Request logging.
  app.use(requestLogger);

  // Feature routes.
  app.use(API_PREFIX, apiRouter);

  // 404 + centralized error handler (must be last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
