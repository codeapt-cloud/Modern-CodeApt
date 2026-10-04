/**
 * Admin Assistant — internal types (Step 40: read-only GUIDE). The assistant has
 * NO write tools; every tool is a read. `AssistantContext` is resolved once in the
 * controller from the session and is the only source of WHO is acting and WHICH
 * tenant is in scope — the model never supplies either.
 */
import type { Role } from "@codeapt/shared";

/** Who may invoke a tool. "both" = any enabled admin; "super" = super-admin only. */
export type Access = "both" | "super";

/** The chat entrypoint the caller came through. */
export type AssistantScope = "platform" | "college";

/** Resolved from the request, never from model output. */
export interface AssistantContext {
  userId: string;
  role: Role;
  /** The caller's PINNED tenant (college scope), or null for a super admin on
   *  the platform entrypoint. A college admin can never see another value. */
  collegeId: string | null;
  scope: AssistantScope;
}

/** Per-call context handed to a tool: the resolved TARGET college + the actor. */
export interface ResolvedCtx {
  userId: string;
  role: Role;
  collegeId: string | null;
  actor: { userId: string; role: Role };
}

/** A read tool. There are intentionally no write tools — a guide never mutates. */
export interface RegisteredTool {
  name: string;
  /** Always "read". Kept explicit so a test can assert no tool mutates. */
  kind: "read";
  access: Access;
  /** true = the tool reads within a single college (collegeId resolved/pinned). */
  needsCollege: boolean;
  description: string;
  argHint: string;
  /** Validate raw model args with the SAME zod schema the HTTP route uses. */
  parse: (raw: unknown) => unknown;
  run: (ctx: ResolvedCtx, args: unknown) => Promise<unknown>;
}
