/**
 * Worker-side AI GOVERNOR config reader (Stage-2). Reads the same single-doc
 * governor settings the API owns, on the worker's Mongoose connection, so the
 * worker's gateway seam makes the identical ALLOW/SHED decision. READ-ONLY.
 * Absent config → the shared defaults apply.
 */
import { AI_GOVERNOR_DEFAULTS, type AiGovernorConfig } from "@codeapt/shared";

import {
  AI_GOVERNOR_CONFIG_KEY,
  AiGovernorConfigModel,
} from "../models/ai-governor.model.js";

export async function getGovernorConfig(): Promise<AiGovernorConfig> {
  const doc = await AiGovernorConfigModel.findOne({
    key: AI_GOVERNOR_CONFIG_KEY,
  }).lean();
  return {
    enabled: doc?.enabled ?? AI_GOVERNOR_DEFAULTS.enabled,
    reservePercent: doc?.reservePercent ?? AI_GOVERNOR_DEFAULTS.reservePercent,
    platformReservePercent:
      doc?.platformReservePercent ?? AI_GOVERNOR_DEFAULTS.platformReservePercent,
    shedThreshold: doc?.shedThreshold ?? AI_GOVERNOR_DEFAULTS.shedThreshold,
  };
}
