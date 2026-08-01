/**
 * Typed, validated environment loader.
 *
 * FAIL FAST: if a required variable is missing or malformed, the process
 * exits before the server starts. There are NO hardcoded secret fallbacks in
 * this code (the original Django app's settings.py bug) — local values live in
 * a gitignored `.env`, real secrets in the deployment environment.
 *
 * External-integration vars (Cloudinary / PhonePe / AI / Piston) are optional
 * here because they are unused by the skeleton; the step that wires each one
 * will tighten them to required at its own boundary.
 */
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // --- Core infrastructure (required to boot) ---
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // --- Auth secrets (required; no fallbacks) ---
  JWT_ACCESS_SECRET: z
    .string()
    .min(16, "JWT_ACCESS_SECRET must be >= 16 chars"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16, "JWT_REFRESH_SECRET must be >= 16 chars"),
  JWT_ACCESS_TTL: z.string().min(1).default("15m"),
  JWT_REFRESH_TTL: z.string().min(1).default("30d"),

  // --- Web / CORS ---
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),

  // --- Auth cookies ---
  // SameSite trade-off: "lax" protects against cross-site POST CSRF while
  // allowing top-level GET navigation (good default for a same-site SPA).
  // Use "none" (requires Secure) only for a cross-site SPA, paired with a
  // CSRF token. Secure is forced on in production regardless.
  COOKIE_SAMESITE: z.enum(["strict", "lax", "none"]).default("lax"),
  COOKIE_DOMAIN: z.string().optional(),

  // --- Auth rate limiting (login/register/refresh) ---
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  // --- Bulk enroll (roster importer) ---
  // Shared default password set on newly-provisioned students; they are forced
  // to reset it on first login. Sourced here (not a source literal) exactly like
  // ADMIN_PASSWORD. Default preserves the original Django behavior.
  BULK_ENROLL_DEFAULT_PASSWORD: z.string().min(1).default("CodeApt@123"),

  // --- Admin bootstrap (used only by the seed:admin script) ---
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_FULL_NAME: z.string().optional(),
  ADMIN_ROLL_NUMBER: z.string().optional(),

  // --- External integrations (optional until their step) ---
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // --- Payments gateway ---
  // Which adapter handles orders. `mock` (default) is deterministic + offline,
  // gated exactly like PISTON_MOCK — there is no live PhonePe merchant here.
  PAYMENT_GATEWAY: z.enum(["mock", "phonepe"]).default("mock"),
  // Secret used to sign/verify the MOCK gateway's callbacks (dev default so the
  // mock works out of the box; override in any shared env).
  PAYMENT_MOCK_SALT: z.string().min(1).default("mock-payment-salt-dev-only"),
  // Where the client returns after the hosted checkout (gateway redirect target).
  PAYMENT_REDIRECT_URL: z
    .string()
    .url()
    .default("http://localhost:5173/payments/return"),
  // Public base URL the gateway calls back to (server-to-server webhook).
  PAYMENT_CALLBACK_URL: z
    .string()
    .url()
    .default("http://localhost:4000/api/payments/callback"),

  PHONEPE_CLIENT_ID: z.string().optional(),
  PHONEPE_CLIENT_SECRET: z.string().optional(),
  PHONEPE_CLIENT_VERSION: z.coerce.number().int().positive().default(1),
  PHONEPE_ENV: z.enum(["SANDBOX", "PRODUCTION"]).optional(),
  // Webhook credentials, configured on the PhonePe merchant dashboard.
  PHONEPE_WEBHOOK_USERNAME: z.string().optional(),
  PHONEPE_WEBHOOK_PASSWORD: z.string().optional(),
  PHONEPE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  AI_SERVICE_URL: z.string().url().optional(),
  PISTON_URL: z.string().url().optional(),

  // --- Essay AI (admin keyword generation; reuses the 5b LLM contract) ---
  // Same variable names as the worker's essay grader so one set of creds serves
  // both. Keyword-gen only calls the LLM when ESSAY_AI_PROVIDER=llm + URL + key;
  // otherwise it falls back to deterministic extraction. Never required.
  ESSAY_AI_PROVIDER: z.enum(["mock", "microservice", "llm"]).default("mock"),
  ESSAY_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  ESSAY_LLM_URL: z.string().url().optional(),
  ESSAY_LLM_API_KEY: z.string().optional(),
  ESSAY_LLM_MODEL: z.string().default("gpt-4o-mini"),

  // --- LLM Gateway (multi-provider router) ---
  // Server-side key that encrypts provider API keys AT REST (AES-256-GCM). Any
  // string; it is stretched to 32 bytes via SHA-256. Optional: without it the
  // gateway stays OFF and callLlmChatJson keeps its single-provider fallback, so
  // nothing breaks. Required to add/decrypt provider keys.
  ENCRYPTION_KEY: z.string().min(16, "ENCRYPTION_KEY must be >= 16 chars").optional(),
  // Per-provider request timeout used by the gateway adapters.
  LLM_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Treat empty-string env vars as unset, so optional fields stay `undefined`
 * and defaults apply (a blank `.env` line should not be a validation error).
 */
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
    // Write directly to stderr; the logger depends on validated env.
    process.stderr.write(
      `\n[env] Invalid environment configuration:\n${issues}\n\n` +
        `Copy apps/api/.env.example to apps/api/.env and fill in the values.\n`,
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
