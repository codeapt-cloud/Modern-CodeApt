/**
 * Gateway wiring. `installLlmGateway()` registers the DB-backed router behind the
 * shared `callLlmChatJson` seam — after which every AI feature (essay grading,
 * essay keywords, AI Test Builder) transparently gains multi-provider failover,
 * rate-limit/quota cooldown, usage tracking, and task-policy routing, with NO
 * change to any caller.
 *
 * Guarded by `ENCRYPTION_KEY`: without it the gateway can't read provider keys,
 * so it stays OFF and the seam keeps its single-provider env fallback.
 */
import { registerLlmRouter } from "@codeapt/shared";

import { isEncryptionConfigured } from "../crypto.js";
import { logger } from "../logger.js";
import { gatewayCallLlmChatJson } from "./gateway.js";

export function installLlmGateway(): void {
  if (!isEncryptionConfigured()) {
    logger.info("LLM gateway disabled (ENCRYPTION_KEY unset) — single-provider fallback");
    return;
  }
  registerLlmRouter((system, user, policy) =>
    gatewayCallLlmChatJson(system, user, policy),
  );
  logger.info("LLM gateway installed behind callLlmChatJson");
}

export { seedAiProviders } from "./seed.js";
export { gatewayCallLlmChatJson } from "./gateway.js";
