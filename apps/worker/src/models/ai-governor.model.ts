/**
 * AI GOVERNOR config (Stage-2) — worker mirror of the API model so the worker's
 * gateway seam can read the same governor tuning on its own Mongoose connection.
 * READ-ONLY here (the API owns writes via the super-admin endpoint).
 */
import { AI_GOVERNOR_DEFAULTS } from "@codeapt/shared";
import { Schema, model, type InferSchemaType } from "mongoose";

export const AI_GOVERNOR_CONFIG_KEY = "global";

const aiGovernorConfigSchema = new Schema(
  {
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
