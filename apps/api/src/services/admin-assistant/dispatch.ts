/**
 * The read dispatcher (Step 40: read-only GUIDE). It re-enforces the guards the
 * HTTP middleware would have applied (access level + tenant pinning + arg
 * validation), runs the read, and writes a READ audit row. There is NO write path
 * — no proposals, no approvals — so there is nothing here that can mutate tenant
 * data beyond the audit trail of what was read.
 */
import {
  AdminAssistantAuditPhase,
  AdminAssistantErrorCode,
  isPlatformAdmin,
  type Role,
} from "@codeapt/shared";
import { Types } from "mongoose";
import { z } from "zod";

import { AppError } from "../../errors/app-error.js";
import { logger } from "../../lib/logger.js";
import { AdminAssistantAuditModel } from "../../models/admin-assistant.model.js";
import { CollegeModel } from "../../models/college.model.js";
import { getTool } from "./registry.js";
import type { AssistantContext, RegisteredTool, ResolvedCtx } from "./types.js";

type RawArgs = Record<string, unknown>;

async function writeAudit(row: {
  actor: string;
  role: Role;
  college: string | null;
  tool: string;
  args: unknown;
  ok: boolean;
  detail?: string;
}): Promise<void> {
  try {
    await AdminAssistantAuditModel.create({
      actor: row.actor,
      role: row.role,
      college: row.college,
      tool: row.tool,
      args: row.args,
      phase: AdminAssistantAuditPhase.READ,
      ok: row.ok,
      detail: row.detail ?? "",
    });
  } catch (err) {
    logger.error({ err, tool: row.tool }, "admin-assistant audit write failed");
  }
}

function assertAccess(ctx: AssistantContext, tool: RegisteredTool): void {
  if (tool.access === "super" && !isPlatformAdmin(ctx.role)) {
    throw new AppError(
      "This lookup is restricted to super admins.",
      403,
      AdminAssistantErrorCode.TOOL_FORBIDDEN,
    );
  }
}

async function requireRealCollege(id: string): Promise<string> {
  if (!Types.ObjectId.isValid(id) || !(await CollegeModel.exists({ _id: id }))) {
    throw new AppError("Unknown college.", 404, AdminAssistantErrorCode.TENANT_FORBIDDEN);
  }
  return id;
}

/** On the college entrypoint the tenant is ALWAYS the pinned session college — a
 *  college admin can never read another tenant. On the platform entrypoint a
 *  super admin may name a college. */
async function resolveTargetCollege(
  ctx: AssistantContext,
  tool: RegisteredTool,
  rawArgs: RawArgs,
): Promise<string | null> {
  if (ctx.scope === "college") return ctx.collegeId; // PINNED
  const named = typeof rawArgs.collegeId === "string" ? rawArgs.collegeId : null;
  if (tool.needsCollege) {
    if (!named) {
      throw new AppError(
        "This lookup needs a target college (collegeId).",
        400,
        AdminAssistantErrorCode.INVALID_ARGS,
      );
    }
    return requireRealCollege(named);
  }
  return named ? requireRealCollege(named) : null;
}

function zodMessage(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
  }
  return "invalid arguments";
}

export async function dispatchRead(
  ctx: AssistantContext,
  toolName: string,
  rawArgs: RawArgs,
): Promise<unknown> {
  const tool = getTool(toolName);
  if (!tool) {
    throw new AppError(
      `Unknown tool “${toolName}”.`,
      400,
      AdminAssistantErrorCode.TOOL_NOT_FOUND,
    );
  }
  assertAccess(ctx, tool);
  const target = await resolveTargetCollege(ctx, tool, rawArgs);
  const { collegeId: _omit, ...rest } = rawArgs;
  let args: unknown;
  try {
    args = tool.parse(rest);
  } catch (err) {
    throw new AppError(
      `Invalid arguments — ${zodMessage(err)}`,
      400,
      AdminAssistantErrorCode.INVALID_ARGS,
    );
  }
  const rctx: ResolvedCtx = {
    userId: ctx.userId,
    role: ctx.role,
    collegeId: target,
    actor: { userId: ctx.userId, role: ctx.role },
  };
  try {
    const data = await tool.run(rctx, args);
    await writeAudit({
      actor: ctx.userId,
      role: ctx.role,
      college: rctx.collegeId,
      tool: tool.name,
      args,
      ok: true,
    });
    return data;
  } catch (err) {
    await writeAudit({
      actor: ctx.userId,
      role: ctx.role,
      college: rctx.collegeId,
      tool: tool.name,
      args,
      ok: false,
      detail: err instanceof AppError ? err.message : "read failed",
    });
    throw err;
  }
}
