/**
 * RefreshSession — one row per active login session (device).
 *
 * Enables refresh-token rotation with reuse detection: the row stores the
 * CURRENT valid refresh identifier (`jti`). On refresh we rotate `jti`; if a
 * client presents a refresh token whose `jti` no longer matches, it is a
 * replay of a rotated/stolen token and the whole session is revoked.
 *
 * `tokenVersion` is the global kill-switch (on User); this per-session row is
 * the fine-grained one (logout a single device, detect replay).
 */
import { Schema, model, type InferSchemaType } from "mongoose";

const refreshSessionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Current valid refresh-token identifier for this session.
    jti: { type: String, required: true },
    // The immediately-previous jti + when we rotated to the current one. During a
    // short grace window after rotation the previous jti is still accepted (it
    // re-issues the current one, without rotating) — this tolerates concurrent /
    // multi-tab refreshes that race the cookie update, instead of falsely flagging
    // them as token reuse and killing the session. Beyond the window, a stale jti
    // is still treated as replay.
    prevJti: { type: String, default: null },
    rotatedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    // Absolute session expiry; TTL index reaps expired rows automatically.
    expiresAt: { type: Date, required: true },
    // Non-authoritative metadata for auditing.
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
  },
  { timestamps: true },
);

// Auto-remove sessions once past their absolute expiry.
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshSession = InferSchemaType<typeof refreshSessionSchema>;
export const RefreshSessionModel = model(
  "RefreshSession",
  refreshSessionSchema,
);
