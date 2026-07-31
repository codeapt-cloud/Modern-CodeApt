/**
 * Worker environment loader — validated, fail-fast, no hardcoded fallbacks.
 */
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // Core infrastructure.
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),

  // How many jobs a single worker processes concurrently.
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  // --- Piston (code execution) ---
  // Base URL of a Piston instance (public https://emkc.org/api/v2/piston or a
  // self-hosted one). Optional so the worker still boots for no-op queues, but
  // code jobs fail with a clear message when it is unset.
  PISTON_URL: z.string().url().optional(),
  // Secondary Piston used ONLY when the primary fails (network/timeout/non-2xx).
  // Defaults to the public emkc instance so a self-hosted primary degrades to a
  // working fallback out of the box. Skipped when equal to the primary.
  PISTON_FALLBACK_URL: z
    .string()
    .url()
    .default("https://emkc.org/api/v2/piston"),
  // Optional extra header (the original sent a DevTunnel anti-phishing header).
  PISTON_HEADER_NAME: z.string().optional(),
  PISTON_HEADER_VALUE: z.string().optional(),
  // Per-request Piston timeout (ms).
  PISTON_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // When true, request the EXACT pinned PISTON_RUNTIMES version per language.
  // Default false → request "*", so Piston selects whichever version the
  // instance actually has installed. Self-hosted boxes rarely match the
  // emkc-pinned patch versions (e.g. python 3.12 vs 3.10), so pinning would
  // fail with "<lang>-<ver> runtime is unknown"; the wildcard is instance-safe.
  PISTON_PIN_RUNTIME_VERSIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Demo/offline only: simulate Piston (no network) so the full job lifecycle
  // can be shown when no Piston instance is reachable. NEVER enable in prod.
  PISTON_MOCK: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // --- Essay AI grading ---
  // Which AI adapter the essay grader uses. `mock` (default) needs no network
  // and returns deterministic-from-text scores, mirroring the PISTON_MOCK
  // convention so the full lifecycle is demoable offline. `microservice` POSTs
  // to ESSAY_AI_URL; `llm` calls an OpenAI-compatible chat endpoint.
  ESSAY_AI_PROVIDER: z.enum(["mock", "microservice", "llm"]).default("mock"),
  // Per-request AI timeout (ms). Original used 45s with graceful fallback.
  ESSAY_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),

  // microservice adapter — base URL + optional auth header (like Piston).
  ESSAY_AI_URL: z.string().url().optional(),
  ESSAY_AI_HEADER_NAME: z.string().optional(),
  ESSAY_AI_HEADER_VALUE: z.string().optional(),

  // llm adapter — OpenAI-compatible chat completions endpoint + key + model.
  ESSAY_LLM_URL: z.string().url().optional(),
  ESSAY_LLM_API_KEY: z.string().optional(),
  ESSAY_LLM_MODEL: z.string().default("gpt-4o-mini"),

  // --- LLM Gateway (multi-provider router) ---
  // Same key the API uses to encrypt provider keys at rest (AES-256-GCM). When
  // set, the worker installs the gateway so essay grading routes through the
  // multi-provider router; when unset the gateway stays OFF (single-provider
  // fallback), mirroring the API's posture.
  ENCRYPTION_KEY: z.string().min(16, "ENCRYPTION_KEY must be >= 16 chars").optional(),
  LLM_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
});

export type Env = z.infer<typeof envSchema>;

/** Treat empty-string env vars as unset so optionals/defaults behave. */
function stripEmpty(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(stripEmpty(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    process.stderr.write(
      `\n[env] Invalid worker environment configuration:\n${issues}\n\n` +
        `Copy apps/worker/.env.example to apps/worker/.env and fill it in.\n`,
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isDevelopment = env.NODE_ENV === "development";
