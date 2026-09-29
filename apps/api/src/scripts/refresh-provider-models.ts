/**
 * Refresh DECOMMISSIONED provider model ids on the LIVE database.
 *
 *   pnpm --filter @codeapt/api gateway:refresh-models
 *
 * WHY THIS EXISTS (separate from the seed):
 *   `seedAiProviders` writes `model`/`baseUrl` with `$setOnInsert` — deliberately,
 *   so it never clobbers a super-admin's edits. The cost is that when a provider
 *   RETIRES a model id (e.g. Groq shut down llama-3.1-8b-instant /
 *   llama-3.3-70b-versatile on 2026-08-16 → every call 404s), bumping the catalog
 *   does NOT fix an already-seeded install. This script is the explicit, opt-in
 *   migration for exactly that: it rewrites a provider's model id ONLY when the
 *   row still holds the known-stale id (so it never overrides a value an admin has
 *   already changed to something they prefer), then clears that provider's cooldown
 *   + failure state so the router retries it immediately instead of waiting out the
 *   10-minute fatal bench.
 *
 * Idempotent: a second run finds nothing on the stale id and changes nothing.
 * Add a row to REFRESHES whenever a provider retires a model out from under us.
 */
import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import {
  AiProviderHealthModel,
  AiProviderModel,
} from "../models/ai-provider.model.js";

interface ModelRefresh {
  /** Provider row to target (matched exactly — the seed's stable identity). */
  name: string;
  /** Only rewrite when the row STILL holds this decommissioned id. */
  from: string;
  /** The currently-served replacement id. */
  to: string;
  /** One-line reason, printed in the report. */
  reason: string;
}

/**
 * Known retirements (verified 2026-09-29):
 *  - Groq decommissioned both free-tier Llama chat models on 2026-08-16; its own
 *    migration targets are the GPT-OSS models at the same OpenAI-compatible endpoint.
 *  - OpenRouter's pinned free `:free` slug rotated out (404); openrouter/free is
 *    OpenRouter's routing model that auto-selects a live free model.
 *  - NVIDIA retired meta/llama-3.1-8b-instruct on integrate.api.nvidia.com (410);
 *    meta/llama-3.3-70b-instruct is currently served.
 * (Cerebras 402 = account needs a verified payment method to activate — NOT a
 * model-id issue; Mistral 429 / Gemma+Cohere timeouts are transient and self-heal.)
 */
const REFRESHES: ModelRefresh[] = [
  {
    name: "Groq Llama 3.1 8B",
    from: "llama-3.1-8b-instant",
    to: "openai/gpt-oss-20b",
    reason: "Groq decommissioned llama-3.1-8b-instant (2026-08-16) → 404",
  },
  {
    name: "Groq Llama 3.3 70B",
    from: "llama-3.3-70b-versatile",
    to: "openai/gpt-oss-120b",
    reason: "Groq decommissioned llama-3.3-70b-versatile (2026-08-16) → 404",
  },
  {
    name: "OpenRouter Free",
    from: "inclusionai/ling-3.0-flash:free",
    to: "openrouter/free",
    reason:
      "OpenRouter free :free slugs rotate weekly → 404; openrouter/free auto-routes to a live free model",
  },
  // NVIDIA rotates its hosted catalog hard: the raw Meta Llama NIMs (3.1-8b,
  // 3.3-70b) all return 410 Gone. Migrate from any of those stale ids to a
  // currently-listed "Free Endpoint" chat model.
  {
    name: "NVIDIA NIM Llama 3.1 8B",
    from: "meta/llama-3.1-8b-instruct",
    to: "nvidia/nemotron-3.5-lightning-30b-a3b",
    reason: "NVIDIA retired meta/llama-3.1-8b-instruct → 410 Gone",
  },
  {
    name: "NVIDIA NIM Llama 3.1 8B",
    from: "meta/llama-3.3-70b-instruct",
    to: "nvidia/nemotron-3.5-lightning-30b-a3b",
    reason: "NVIDIA also retired meta/llama-3.3-70b-instruct → 410 Gone",
  },
];

async function refreshProviderModels(): Promise<void> {
  await connectDatabase();
  try {
    let changed = 0;
    for (const r of REFRESHES) {
      // Target the row only while it still carries the stale id — never clobber
      // a model an admin has already retargeted themselves. findOneAndUpdate (not
      // load-mutate-save) avoids the Mongoose Document.model collision on the
      // same-named schema field.
      const provider = await AiProviderModel.findOneAndUpdate(
        { name: r.name, model: r.from },
        { $set: { model: r.to } },
        { new: true },
      );
      if (!provider) {
        logger.info(
          { provider: r.name, expect: r.from },
          "skip — not on the stale id (already fixed, renamed, or absent)",
        );
        continue;
      }

      // Clear the fatal bench + failure streak so the router retries it now
      // rather than after the ~10-minute cooldown. reliability recovers on the
      // next successful call; reset it so selection doesn't deprioritise it.
      await AiProviderHealthModel.updateOne(
        { provider: provider._id },
        {
          $set: {
            cooldownUntil: null,
            consecutiveFailures: 0,
            reliability: 1,
            lastError: "",
          },
        },
      );

      changed += 1;
      logger.info(
        { provider: r.name, from: r.from, to: r.to, why: r.reason },
        "refreshed provider model id + cleared cooldown",
      );
    }
    logger.info(
      { changed, checked: REFRESHES.length },
      changed > 0
        ? "provider model refresh complete"
        : "nothing to refresh — all providers already off the known-stale ids",
    );
  } finally {
    await disconnectDatabase();
  }
}

refreshProviderModels()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "gateway:refresh-models failed");
    process.exit(1);
  });
