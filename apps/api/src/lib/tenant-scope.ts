/**
 * Tenant-scoping helper — the ONE seam every college-scoped query/write MUST go
 * through in later phases. It injects `college: <id>` into filters and onto new
 * documents, and REFUSES to build a scope without a tenant id, so a college
 * query can never accidentally run unscoped (which would leak across tenants).
 *
 * Usage (later phases):
 *   const scope = createTenantScope(req.tenant.college.id);
 *   await ExamModel.find(scope.filter({ status: "published" }));   // AND college
 *   await ExamModel.create(scope.attach({ title }));               // sets college
 *
 * Individual (B2C) models are NOT college-scoped and never use this helper.
 * See docs/MULTI_TENANT_ARCHITECTURE.md (Tenancy rules).
 */
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { TenantErrorCode } from "@codeapt/shared";

export interface TenantScope {
  /** The tenant (college) ObjectId this scope is bound to. */
  readonly collegeId: Types.ObjectId;
  /** Merge `{ college }` into a query filter (AND-ed with the caller's fields). */
  filter<T extends Record<string, unknown>>(
    extra?: T,
  ): T & { college: Types.ObjectId };
  /** Merge `{ college }` onto a document being created. */
  attach<T extends Record<string, unknown>>(
    doc: T,
  ): T & { college: Types.ObjectId };
}

/**
 * Build a tenant scope bound to a college id. Throws TENANT_CONTEXT_REQUIRED if
 * the id is missing/invalid — this is the guardrail that makes forgetting to
 * scope a hard failure rather than a silent cross-tenant leak.
 */
export function createTenantScope(
  collegeId: string | Types.ObjectId | null | undefined,
): TenantScope {
  if (!collegeId || !Types.ObjectId.isValid(collegeId)) {
    throw new AppError(
      "A college (tenant) context is required for this operation",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  const id = new Types.ObjectId(collegeId);
  return {
    collegeId: id,
    filter: (extra) => ({ ...(extra ?? {}), college: id }) as never,
    attach: (doc) => ({ ...doc, college: id }),
  };
}
