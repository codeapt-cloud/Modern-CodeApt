/**
 * Platform settings — a SINGLETON document (one row, `key: "platform"`) holding
 * super-admin-tunable, deploy-free config. Introduced in Step 32 for the default
 * speech engine a new speaking assessment inherits; kept deliberately generic so
 * later platform toggles land here rather than sprouting env vars a super admin
 * can't change without a redeploy. Read/written only by platform-settings.service.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import { SPEECH_ENGINE_VALUES, SpeechEngine } from "@codeapt/shared";

const platformSettingsSchema = new Schema(
  {
    // The singleton key — a unique index guarantees exactly one document.
    key: { type: String, required: true, unique: true, default: "platform" },
    // Step 32: engine a new speaking assessment defaults to (author may override).
    defaultSpeechEngine: {
      type: String,
      enum: SPEECH_ENGINE_VALUES,
      default: SpeechEngine.WHISPER,
    },
  },
  { timestamps: true },
);

export type PlatformSettingsDoc = InferSchemaType<typeof platformSettingsSchema>;
export const PlatformSettingsModel = model(
  "PlatformSettings",
  platformSettingsSchema,
);
