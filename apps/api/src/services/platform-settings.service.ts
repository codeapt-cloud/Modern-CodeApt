/**
 * Platform settings service (Step 32) — read/update the singleton settings doc.
 * `getPlatformSettings` upserts-then-reads so the row always exists with safe
 * defaults (defaultSpeechEngine = whisper, i.e. today's behaviour). Update is a
 * partial patch behind requireAdmin. Other services call `getDefaultSpeechEngine`.
 */
import {
  SpeechEngine,
  type PlatformSettings,
  type PlatformSettingsUpdate,
  type SpeechEngine as SpeechEngineT,
} from "@codeapt/shared";

import { PlatformSettingsModel } from "../models/platform-settings.model.js";

async function loadOrCreate() {
  return PlatformSettingsModel.findOneAndUpdate(
    { key: "platform" },
    { $setOnInsert: { key: "platform" } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const doc = await loadOrCreate();
  return {
    defaultSpeechEngine:
      (doc.defaultSpeechEngine as SpeechEngineT) ?? SpeechEngine.WHISPER,
  };
}

/** The default engine a new speaking assessment inherits when the author omits
 *  one. Falls back to whisper if the settings read fails for any reason (safe). */
export async function getDefaultSpeechEngine(): Promise<SpeechEngineT> {
  try {
    return (await getPlatformSettings()).defaultSpeechEngine;
  } catch {
    return SpeechEngine.WHISPER;
  }
}

export async function updatePlatformSettings(
  input: PlatformSettingsUpdate,
): Promise<PlatformSettings> {
  const doc = await loadOrCreate();
  if (input.defaultSpeechEngine !== undefined) {
    doc.defaultSpeechEngine = input.defaultSpeechEngine;
  }
  await doc.save();
  return {
    defaultSpeechEngine:
      (doc.defaultSpeechEngine as SpeechEngineT) ?? SpeechEngine.WHISPER,
  };
}
