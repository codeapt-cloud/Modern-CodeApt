/**
 * LLM Gateway storage (PLATFORM-level, super-admin owned — NOT tenant-scoped).
 *
 *  - AiProvider: a configured free-tier provider (kind → adapter, baseUrl, model,
 *    documented limits, priority, trainsOnData, capability). Seeded from the
 *    catalog; managed from the admin UI (Prompt 2).
 *  - AiProviderKey: an API key for a provider, ENCRYPTED AT REST (never stored or
 *    returned in plaintext — see lib/crypto.ts). A provider may hold several keys.
 *  - AiProviderHealth: per-provider rolling usage (requests + tokens in the
 *    current minute/day windows) + cooldown/failure/reliability. Powers the
 *    router's headroom/cooldown logic and the monitoring page.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  PROVIDER_CAPABILITY_VALUES,
  PROVIDER_KIND_VALUES,
  ProviderCapability,
} from "@codeapt/shared";

const limitsSchema = new Schema(
  {
    requestsPerMinute: { type: Number, default: null },
    requestsPerDay: { type: Number, default: null },
    tokensPerMinute: { type: Number, default: null },
    tokensPerDay: { type: Number, default: null },
  },
  { _id: false },
);

const aiProviderSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    kind: { type: String, enum: PROVIDER_KIND_VALUES, required: true },
    baseUrl: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    /** Console where a super-admin claims a free API key for this provider. */
    keyUrl: { type: String, default: "", trim: true },
    enabled: { type: Boolean, default: true },
    /** Lower = preferred in the router chain. */
    priority: { type: Number, default: 100 },
    limits: { type: limitsSchema, default: () => ({}) },
    /** True = provider may train on inputs → excluded for sensitive tasks. */
    trainsOnData: { type: Boolean, default: false },
    capability: {
      type: String,
      enum: PROVIDER_CAPABILITY_VALUES,
      default: ProviderCapability.FAST,
    },
  },
  { timestamps: true },
);
aiProviderSchema.index({ enabled: 1, priority: 1 });

const aiProviderKeySchema = new Schema(
  {
    provider: {
      type: Schema.Types.ObjectId,
      ref: "AiProvider",
      required: true,
      index: true,
    },
    /** AES-256-GCM ciphertext blob (`v1:iv:tag:data`). NEVER plaintext. */
    keyCiphertext: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    label: { type: String, default: "", trim: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const aiProviderHealthSchema = new Schema(
  {
    provider: {
      type: Schema.Types.ObjectId,
      ref: "AiProvider",
      required: true,
      unique: true,
    },
    // Rolling windows — counters reset when `now` crosses the window boundary.
    minuteWindowStart: { type: Number, default: 0 },
    minuteRequests: { type: Number, default: 0 },
    minuteTokens: { type: Number, default: 0 },
    dayWindowStart: { type: Number, default: 0 },
    dayRequests: { type: Number, default: 0 },
    dayTokens: { type: Number, default: 0 },
    // Health.
    cooldownUntil: { type: Number, default: null },
    consecutiveFailures: { type: Number, default: 0 },
    reliability: { type: Number, default: 1 },
    lastError: { type: String, default: "" },
    lastErrorAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type AiProviderDoc = InferSchemaType<typeof aiProviderSchema>;
export type AiProviderKeyDoc = InferSchemaType<typeof aiProviderKeySchema>;
export type AiProviderHealthDoc = InferSchemaType<typeof aiProviderHealthSchema>;

export const AiProviderModel = model("AiProvider", aiProviderSchema);
export const AiProviderKeyModel = model("AiProviderKey", aiProviderKeySchema);
export const AiProviderHealthModel = model(
  "AiProviderHealth",
  aiProviderHealthSchema,
);
