/**
 * Seeded free-tier provider catalog. Priority (lower = preferred) follows the
 * documented limits × capability: fast/high-volume providers first for cheap
 * throughput, capable step-ups behind them. `trainsOnData` marks providers that
 * may train on inputs (excluded for sensitive/student-data tasks). Keys are NOT
 * seeded — a super-admin adds them (encrypted) via the admin UI (Prompt 2); a
 * provider with no key is simply skipped by the router until one is added.
 *
 * Limits are the documented free-tier ceilings (approximate; the admin UI can
 * tune them). Cloudflare's baseUrl carries an ACCOUNT_ID placeholder the admin
 * fills in.
 */
import { ProviderCapability, ProviderKind } from "@codeapt/shared";

export interface SeedProvider {
  name: string;
  kind: (typeof ProviderKind)[keyof typeof ProviderKind];
  baseUrl: string;
  model: string;
  /** Console where the super-admin claims a free API key. */
  keyUrl: string;
  priority: number;
  capability: (typeof ProviderCapability)[keyof typeof ProviderCapability];
  trainsOnData: boolean;
  enabled: boolean;
  limits: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
    tokensPerMinute?: number;
    tokensPerDay?: number;
  };
}

export const PROVIDER_CATALOG: SeedProvider[] = [
  {
    name: "Groq Llama 3.1 8B",
    kind: ProviderKind.OPENAI_COMPAT,
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.1-8b-instant",
    keyUrl: "https://console.groq.com/keys",
    priority: 10,
    capability: ProviderCapability.FAST,
    trainsOnData: false,
    enabled: true,
    limits: { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 6000 },
  },
  {
    // Gemma on the hosted Gemini API is the Gemma 4 family (Gemma 3 ids like
    // `gemma-3-27b-it` were retired → 404). Model ids drift + vary by account,
    // so a super-admin can edit this from the AI Providers page + Test.
    name: "Google Gemma 4 26B",
    kind: ProviderKind.GOOGLE,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemma-4-26b-a4b-it",
    keyUrl: "https://aistudio.google.com/apikey",
    priority: 20,
    capability: ProviderCapability.FAST,
    trainsOnData: true, // Google (outside EEA) trains on free-tier inputs
    enabled: true,
    limits: { requestsPerMinute: 30, requestsPerDay: 14400 },
  },
  {
    name: "Google Gemini 2.0 Flash-Lite",
    kind: ProviderKind.GOOGLE,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.0-flash-lite",
    keyUrl: "https://aistudio.google.com/apikey",
    priority: 30,
    capability: ProviderCapability.FAST,
    trainsOnData: true,
    enabled: true,
    limits: { requestsPerMinute: 30, requestsPerDay: 1500 },
  },
  {
    name: "Groq Llama 3.3 70B",
    kind: ProviderKind.OPENAI_COMPAT,
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyUrl: "https://console.groq.com/keys",
    priority: 40,
    capability: ProviderCapability.CAPABLE,
    trainsOnData: false,
    enabled: true,
    limits: { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 12000 },
  },
  {
    name: "Cerebras gpt-oss-120B",
    kind: ProviderKind.OPENAI_COMPAT,
    baseUrl: "https://api.cerebras.ai/v1",
    model: "gpt-oss-120b",
    keyUrl: "https://cloud.cerebras.ai/",
    priority: 50,
    capability: ProviderCapability.CAPABLE,
    trainsOnData: false,
    enabled: true,
    limits: { requestsPerMinute: 30, requestsPerDay: 14400, tokensPerMinute: 60000 },
  },
  {
    // Account-scoped: the admin MUST replace <ACCOUNT_ID> in the base URL with
    // their Cloudflare account id (AI Providers → Edit) before this can work, so
    // it ships DISABLED/addable — otherwise it 404s on the placeholder path.
    name: "Cloudflare Workers AI",
    kind: ProviderKind.CLOUDFLARE,
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run",
    model: "@cf/meta/llama-3.1-8b-instruct",
    keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    priority: 60,
    capability: ProviderCapability.FAST,
    trainsOnData: false,
    enabled: false,
    limits: { requestsPerDay: 10000 },
  },
  {
    // OpenRouter rotates which slugs are served on the free tier — retired ids
    // (e.g. `meta-llama/llama-3.3-70b-instruct:free`) 404. Seed a currently-live
    // free slug; a super-admin can Edit it to any live `:free` slug from
    // GET /api/v1/models (or drop `:free` for the cheap paid variant).
    name: "OpenRouter Free",
    kind: ProviderKind.OPENAI_COMPAT,
    baseUrl: "https://openrouter.ai/api/v1",
    model: "inclusionai/ling-3.0-flash:free",
    keyUrl: "https://openrouter.ai/keys",
    priority: 70,
    capability: ProviderCapability.CAPABLE,
    trainsOnData: true, // free OpenRouter endpoints may log/train on prompts
    enabled: true,
    limits: { requestsPerDay: 50 },
  },
  {
    name: "Cohere Command R",
    kind: ProviderKind.COHERE,
    baseUrl: "https://api.cohere.ai",
    model: "command-r-08-2024",
    keyUrl: "https://dashboard.cohere.com/api-keys",
    priority: 80,
    capability: ProviderCapability.CAPABLE,
    trainsOnData: false,
    enabled: true,
    limits: { requestsPerMinute: 20, requestsPerDay: 1000 },
  },
  {
    name: "Mistral Small",
    kind: ProviderKind.OPENAI_COMPAT,
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    keyUrl: "https://console.mistral.ai/api-keys/",
    priority: 90,
    capability: ProviderCapability.CAPABLE,
    trainsOnData: true,
    enabled: false, // addable — off until a key + terms are set
    limits: { requestsPerMinute: 60 },
  },
  {
    name: "NVIDIA NIM Llama 3.1 8B",
    kind: ProviderKind.OPENAI_COMPAT,
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "meta/llama-3.1-8b-instruct",
    keyUrl: "https://build.nvidia.com/",
    priority: 100,
    capability: ProviderCapability.CAPABLE,
    trainsOnData: false,
    enabled: false, // addable
    limits: { requestsPerMinute: 40 },
  },
];
