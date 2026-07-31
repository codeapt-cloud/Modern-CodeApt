import { Router } from "express";

import {
  getJobStatusController,
  streamJobController,
  submitExecutionController,
} from "../controllers/execution.controller.js";
import { enforcePasswordChange } from "../middleware/enforce-password-change.js";
import { executeRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";

export const executionRouter: Router = Router();

const authed = [requireAuth, enforcePasswordChange];

// Fast submit — creates the job row + enqueues, returns { jobId, status }.
executionRouter.post(
  "/execute",
  ...authed,
  executeRateLimiter,
  submitExecutionController,
);

// Poll or stream status/result (ownership enforced in the service).
executionRouter.get("/execute/:jobId", ...authed, getJobStatusController);
executionRouter.get("/execute/:jobId/stream", ...authed, streamJobController);
