/**
 * Rate limiting for auth endpoints (login/register/refresh). In-memory store
 * is fine for a single instance; a Redis-backed store is a later concern for
 * horizontal scaling. Skipped under NODE_ENV=test to keep tests deterministic.
 */
import {
  ESSAY_SUBMIT_RATE_LIMIT_MAX,
  ESSAY_SUBMIT_RATE_LIMIT_WINDOW_MS,
  EssayErrorCode,
  EXECUTE_RATE_LIMIT_MAX,
  EXECUTE_RATE_LIMIT_WINDOW_MS,
  ExecutionErrorCode,
  PAYMENT_ORDER_RATE_LIMIT_MAX,
  PAYMENT_ORDER_RATE_LIMIT_WINDOW_MS,
  PaymentErrorCode,
  PUBLIC_EXAM_RATE_LIMIT_MAX,
  PUBLIC_EXAM_RATE_LIMIT_WINDOW_MS,
} from "@codeapt/shared";
import rateLimit from "express-rate-limit";

import { env } from "../config/env.js";

export const authRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  message: {
    error: {
      message: "Too many attempts, please try again later",
      code: "RATE_LIMITED",
    },
  },
});

/**
 * Per-user rate limit for code submissions (falls back to IP when unauthed,
 * though the route requires auth). Guards the worker + Piston from a runaway
 * client. Skipped under NODE_ENV=test.
 */
export const executeRateLimiter = rateLimit({
  windowMs: EXECUTE_RATE_LIMIT_WINDOW_MS,
  max: EXECUTE_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "anonymous",
  message: {
    error: {
      message: "Too many runs, please slow down",
      code: ExecutionErrorCode.RATE_LIMITED,
    },
  },
});

/**
 * Per-user rate limit for essay submissions (grading is comparatively cheap,
 * but this guards the queue + AI dependency from a runaway client). Skipped
 * under NODE_ENV=test.
 */
export const essaySubmitRateLimiter = rateLimit({
  windowMs: ESSAY_SUBMIT_RATE_LIMIT_WINDOW_MS,
  max: ESSAY_SUBMIT_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "anonymous",
  message: {
    error: {
      message: "Too many essay submissions, please slow down",
      code: EssayErrorCode.RATE_LIMITED,
    },
  },
});

/** Per-user rate limit for payment order creation. Skipped under NODE_ENV=test. */
export const paymentOrderRateLimiter = rateLimit({
  windowMs: PAYMENT_ORDER_RATE_LIMIT_WINDOW_MS,
  max: PAYMENT_ORDER_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "anonymous",
  message: {
    error: {
      message: "Too many payment attempts, please slow down",
      code: PaymentErrorCode.RATE_LIMITED,
    },
  },
});

/**
 * Per-user rate limit for the super-admin LLM-provider key probe — a live probe
 * hits an external provider, so cap it (15/min) to prevent abuse. Skipped under
 * NODE_ENV=test.
 */
export const aiProviderTestRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "anonymous",
  message: {
    error: {
      message: "Too many provider tests, please slow down",
      code: "RATE_LIMITED",
    },
  },
});

/**
 * Per-user rate limit for signed-upload signature minting. Each signature lets
 * the caller push a file to our shared Cloudinary account (billed on
 * storage/bandwidth), so cap it (30/min) to stop a college user from minting
 * signatures in a loop. Applied to the tenant `/c/:slug/uploads/signature`
 * route; the platform-admin `/admin/uploads/signature` route has NO limiter
 * today (trusted, small operator set) — see the step report. Skipped under
 * NODE_ENV=test.
 */
export const uploadSignatureRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "anonymous",
  message: {
    error: {
      message: "Too many upload requests, please slow down",
      code: "RATE_LIMITED",
    },
  },
});

/**
 * Per-user rate limit for the gaming ANSWER endpoint. Real play is one answer
 * every ~10-15s (≈4-6/min); 90/min is generous headroom for fast clearers and
 * retries while still bounding a runaway/abusive client to a sane rate (not the
 * thousands/min an unthrottled loop could push on the hot path). Skipped under
 * NODE_ENV=test.
 */
export const gameAnswerRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "anonymous",
  message: {
    error: {
      message: "Too many answers, please slow down",
      code: "RATE_LIMITED",
    },
  },
});

/**
 * Per-user rate limit for the interactive PROBE endpoint (door_key). A probe is
 * a single keypress/move, so honest play is bursty — 2-3 moves/second, plus
 * key-repeat while sensing a maze — far denser than one answer per question.
 * 600/min (10/s) is generous headroom for the fastest keyboard play while still
 * bounding a runaway/looping client to a sane rate (not the thousands/min an
 * unthrottled loop could push). Higher than gameAnswerRateLimiter by design.
 * Skipped under NODE_ENV=test.
 */
export const gameProbeRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "anonymous",
  message: {
    error: {
      message: "Too many moves, please slow down",
      code: "RATE_LIMITED",
    },
  },
});

/**
 * Per-user rate limit for AUTHENTICATED exam-attempt starts (individual +
 * college). A start can be code-gated, so this throttles start-code guessing —
 * the anonymous public start is already per-IP limited below. The cap is modest
 * (a legitimate student starts an exam rarely, with a few retries for typos).
 * Skipped under NODE_ENV=test.
 */
export const startAttemptRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "anonymous",
  message: {
    error: {
      message: "Too many start attempts. Please wait a minute and try again.",
      code: "RATE_LIMITED",
      details: { retryAfterSeconds: 60 },
    },
  },
});

/** Per-IP rate limit for anonymous public-exam starts. Skipped under test. */
export const publicExamRateLimiter = rateLimit({
  windowMs: PUBLIC_EXAM_RATE_LIMIT_WINDOW_MS,
  max: PUBLIC_EXAM_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  message: {
    error: {
      message:
        "Too many attempts from this network. Please wait a minute and try again.",
      code: "RATE_LIMITED",
      // The window is one minute; tell the client how long to hold off.
      details: {
        retryAfterSeconds: Math.ceil(PUBLIC_EXAM_RATE_LIMIT_WINDOW_MS / 1000),
      },
    },
  },
});
