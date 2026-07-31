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

/** Per-IP rate limit for anonymous public-exam starts. Skipped under test. */
export const publicExamRateLimiter = rateLimit({
  windowMs: PUBLIC_EXAM_RATE_LIMIT_WINDOW_MS,
  max: PUBLIC_EXAM_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  message: {
    error: {
      message: "Too many attempts from this network, please try again later",
      code: "RATE_LIMITED",
    },
  },
});
