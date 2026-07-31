/**
 * Centralized error-handling middleware. Must be registered LAST.
 * Translates thrown errors (AppError, Zod, Mongoose) into a consistent
 * `{ error: { message, code, details } }` envelope.
 */
import type { ErrorRequestHandler, RequestHandler } from "express";
import mongoose, { Error as MongooseError } from "mongoose";
import { ZodError } from "zod";

import { AppError } from "../errors/app-error.js";
import { isProduction } from "../config/env.js";

/** 404 fallback for unmatched routes. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      code: "NOT_FOUND",
    },
  });
};

// Express identifies error handlers by their 4-arg arity, so `_next` must stay.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let statusCode = 500;
  let code = "INTERNAL_ERROR";
  let message = "Internal server error";
  let details: unknown;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    code = "VALIDATION_ERROR";
    message = "Request validation failed";
    details = err.issues;
  } else if (err instanceof MongooseError.ValidationError) {
    statusCode = 400;
    code = "VALIDATION_ERROR";
    message = err.message;
    details = err.errors;
  } else if (
    err instanceof mongoose.mongo.MongoServerError &&
    err.code === 11000
  ) {
    statusCode = 409;
    code = "DUPLICATE_KEY";
    message = "A record with these unique fields already exists";
    details = err.keyValue;
  } else if (err instanceof Error) {
    message = err.message;
  }

  // Log 5xx as errors, 4xx as warnings.
  const log = req.log ?? console;
  if (statusCode >= 500) {
    log.error({ err, code }, "Request failed");
  } else {
    log.warn({ code, message }, "Request rejected");
  }

  res.status(statusCode).json({
    error: {
      message,
      code,
      ...(details !== undefined ? { details } : {}),
      ...(!isProduction && err instanceof Error && statusCode >= 500
        ? { stack: err.stack }
        : {}),
    },
  });
};
