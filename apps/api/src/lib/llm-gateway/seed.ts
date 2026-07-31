/**
 * Idempotent provider seeding. Inserts any catalog provider that doesn't already
 * exist (matched by name) via `$setOnInsert`, so re-running never clobbers a
 * super-admin's edits (enabled/priority/model/limits) or their keys. Safe to
 * call on every boot.
 */
import { AiProviderModel } from "../../models/ai-provider.model.js";
import { logger } from "../logger.js";
import { PROVIDER_CATALOG } from "./catalog.js";

export async function seedAiProviders(): Promise<{ created: number }> {
  let created = 0;
  for (const p of PROVIDER_CATALOG) {
    const res = await AiProviderModel.updateOne(
      { name: p.name },
      {
        // keyUrl is curated (not admin-editable), so keep it current on every
        // boot — this also backfills existing installs seeded before it existed.
        $set: { keyUrl: p.keyUrl },
        $setOnInsert: {
          name: p.name,
          kind: p.kind,
          baseUrl: p.baseUrl,
          model: p.model,
          enabled: p.enabled,
          priority: p.priority,
          capability: p.capability,
          trainsOnData: p.trainsOnData,
          limits: p.limits,
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount > 0) created += 1;
  }
  if (created > 0) logger.info({ created }, "Seeded AI providers");
  return { created };
}
