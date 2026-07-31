/**
 * Execution controllers — thin: validate with the shared schema, resolve the
 * caller, delegate to the service. The submit handler returns a jobId without
 * waiting on execution; the stream handler pushes status transitions over SSE
 * so the client can avoid polling (it falls back to polling if SSE fails).
 */
import { AuthErrorCode, executeRequestSchema } from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as execution from "../services/execution.service.js";

function requireUserId(req: Request): string {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return req.auth.userId;
}

export const submitExecutionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = executeRequestSchema.parse(req.body);
    const ref = await execution.submitExecution(requireUserId(req), input);
    res.status(202).json(ref);
  },
);

export const getJobStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await execution.getJobStatus(
      requireUserId(req),
      req.params.jobId ?? "",
    );
    res.status(200).json(data);
  },
);

/** Terminal statuses close the SSE stream. */
const TERMINAL = new Set(["completed", "failed"]);
const SSE_POLL_MS = 700;
const SSE_MAX_MS = 2 * 60 * 1000;

export const streamJobController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const jobId = req.params.jobId ?? "";

    // Verify existence + ownership before opening the stream (throws → normal
    // JSON error via the error handler).
    let snapshot = await execution.getJobStatus(userId, jobId);

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    let closed = false;
    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send("status", snapshot);
    if (TERMINAL.has(snapshot.status)) {
      res.end();
      return;
    }

    const startedAt = Date.now();
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      res.end();
    };

    const timer = setInterval(() => {
      void (async () => {
        if (closed) return;
        try {
          const next = await execution.getJobStatus(userId, jobId);
          if (next.status !== snapshot.status || TERMINAL.has(next.status)) {
            snapshot = next;
            send("status", next);
          }
          if (
            TERMINAL.has(next.status) ||
            Date.now() - startedAt > SSE_MAX_MS
          ) {
            cleanup();
          }
        } catch {
          // Transient read error — let the client fall back to polling.
          cleanup();
        }
      })();
    }, SSE_POLL_MS);

    req.on("close", cleanup);
  },
);
