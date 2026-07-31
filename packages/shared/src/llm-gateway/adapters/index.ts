/** Adapter registry — resolve the ProviderAdapter for a provider kind. */
import { ProviderKind } from "../types.js";
import { openAiCompatAdapter, type ProviderAdapter } from "./base.js";
import { cloudflareAdapter } from "./cloudflare.js";
import { cohereAdapter } from "./cohere.js";
import { googleAdapter } from "./google.js";

const ADAPTERS: Record<ProviderKind, ProviderAdapter> = {
  [ProviderKind.OPENAI_COMPAT]: openAiCompatAdapter,
  [ProviderKind.GOOGLE]: googleAdapter,
  [ProviderKind.COHERE]: cohereAdapter,
  [ProviderKind.CLOUDFLARE]: cloudflareAdapter,
};

export function adapterFor(kind: ProviderKind): ProviderAdapter {
  return ADAPTERS[kind] ?? openAiCompatAdapter;
}

export { openAiCompatAdapter, googleAdapter, cohereAdapter, cloudflareAdapter };
export type { ProviderAdapter };
