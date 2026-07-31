/**
 * AI GOVERNOR config (Stage-2) — a single-document settings row (PLATFORM-level,
 * super-admin owned; NOT tenant-scoped). Holds the global free-tier pool
 * governor tuning: reserve floors + the shed threshold + the on/off switch.
 * Read at the gateway seam to decide ALLOW vs SHED for a call about to be made.
 *
 * Singleton: keyed by a fixed `key: "global"` (unique) so there is exactly one
 * config; absent → the shared `AI_GOVERNOR_DEFAULTS` apply (see the service).
 */
import { AI_GOVERNOR_DEFAULTS } from "@codeapt/shared";
import { Schema, model, type InferSchemaType } from "mongoose";

export const AI_GOVERNOR_CONFIG_KEY = "global";

const aiGovernorConfigSchema = new Schema(
  {
    /** Fixed singleton discriminator. */
    key: { type: String, required: true, unique: true, default: AI_GOVERNOR_CONFIG_KEY },
    enabled: { type: Boolean, default: AI_GOVERNOR_DEFAULTS.enabled },
    reservePercent: { type: Number, default: AI_GOVERNOR_DEFAULTS.reservePercent },
    platformReservePercent: {
      type: Number,
      default: AI_GOVERNOR_DEFAULTS.platformReservePercent,
    },
    shedThreshold: { type: Number, default: AI_GOVERNOR_DEFAULTS.shedThreshold },
  },
  { timestamps: true },
);

export type AiGovernorConfigDoc = InferSchemaType<typeof aiGovernorConfigSchema>;
export const AiGovernorConfigModel = model(
  "AiGovernorConfig",
  aiGovernorConfigSchema,
);
