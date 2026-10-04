/**
 * Admin Assistant storage (Step 40: read-only GUIDE).
 *
 * Only ONE collection remains: AdminAssistantAudit — one row per read the guide
 * performed (actor, tenant, tool, args, outcome). The Step-38 AdminAssistantProposal
 * collection and all write/approval machinery were DELETED: a guide never mutates,
 * so there is nothing to propose, approve, freeze or audit on the write side.
 */
import { Schema, model, type InferSchemaType } from "mongoose";

import { ADMIN_ASSISTANT_AUDIT_PHASE_VALUES } from "@codeapt/shared";

const adminAssistantAuditSchema = new Schema(
  {
    actor: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: { type: String, required: true },
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    tool: { type: String, required: true },
    args: { type: Schema.Types.Mixed, default: {} },
    // Always "read" now (the enum has only READ) — kept for forward-compatibility.
    phase: {
      type: String,
      enum: ADMIN_ASSISTANT_AUDIT_PHASE_VALUES,
      required: true,
    },
    ok: { type: Boolean, required: true },
    detail: { type: String, default: "" },
  },
  { timestamps: true },
);
adminAssistantAuditSchema.index({ college: 1, createdAt: -1 });

export type AdminAssistantAudit = InferSchemaType<typeof adminAssistantAuditSchema>;
export const AdminAssistantAuditModel = model(
  "AdminAssistantAudit",
  adminAssistantAuditSchema,
);
