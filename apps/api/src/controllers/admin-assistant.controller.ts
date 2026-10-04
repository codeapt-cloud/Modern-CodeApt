/**
 * Admin Assistant controllers (Step 40: read-only GUIDE). Resolve the
 * AssistantContext from the SESSION (never the body) and hand off to the chat
 * service. There is no approve/reject path — the guide never writes.
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  adminAssistantChatSchema,
  type Role,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  handleChat,
  type AssistantContext,
} from "../services/admin-assistant/index.js";

function auth(req: Request): { userId: string; role: Role } {
  if (!req.auth) {
    throw new AppError("Authentication required", 401, AuthErrorCode.UNAUTHENTICATED);
  }
  return { userId: req.auth.userId, role: req.auth.role };
}

function collegeContext(req: Request): AssistantContext {
  if (!req.tenant) {
    throw new AppError(
      "A college (tenant) context is required",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  const { userId, role } = auth(req);
  return { userId, role, collegeId: req.tenant.college.id, scope: "college" };
}

function platformContext(req: Request): AssistantContext {
  const { userId, role } = auth(req);
  return { userId, role, collegeId: null, scope: "platform" };
}

export const collegeAssistantChatController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = adminAssistantChatSchema.parse(req.body);
    res.json(await handleChat(collegeContext(req), body.messages, body.knownFacts));
  },
);

export const platformAssistantChatController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = adminAssistantChatSchema.parse(req.body);
    res.json(await handleChat(platformContext(req), body.messages, body.knownFacts));
  },
);
