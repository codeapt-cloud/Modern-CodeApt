/**
 * Paced-AI processor (Stage-2 governor) — drains governor-DEFERRED AI calls on
 * the `ai-paced` queue. The worker running this queue is RATE-LIMITED (BullMQ
 * limiter) so the backlog drains within provider minute-limits and never rate-
 * limits everyone.
 *
 * It re-runs the exact deferred call through the gateway with `internalPaced`
 * set — so the Stage-2 governor is SKIPPED (this IS the paced execution; it must
 * run-or-fail, never re-defer), while Stage-1 per-college metering and the
 * router's own headroom gate still apply. A successful run WARMS the response
 * cache, so the original caller's retry becomes a cheap cache hit. Never throws
 * (a failed drain just leaves the cache cold; the caller retries later).
 */
import { pacedAiJobSchema, type LlmTaskPolicy } from "@codeapt/shared";
import type { Job, Processor } from "bullmq";

import { logger } from "../lib/logger.js";
import { gatewayCallLlmChatJson } from "../lib/llm-gateway/index.js";

export const pacedAiProcessor: Processor = async (job: Job) => {
  const parsed = pacedAiJobSchema.safeParse(job.data ?? {});
  if (!parsed.success) {
    logger.warn({ jobId: job.id }, "paced-ai: malformed payload — skipping");
    return { ok: false, reason: "malformed" };
  }
  const { system, user, policy } = parsed.data;
  const runPolicy = {
    ...(policy as Partial<LlmTaskPolicy> | undefined),
    internalPaced: true,
  } as LlmTaskPolicy;

  try {
    const result = await gatewayCallLlmChatJson(system, user, runPolicy);
    const warmed = result !== null;
    logger.info(
      { jobId: job.id, feature: runPolicy.feature, warmed },
      `paced-ai drained (${warmed ? "cache warmed" : "still unavailable"})`,
    );
    return { ok: true, warmed };
  } catch (err) {
    logger.error({ jobId: job.id, err }, "paced-ai drain failed");
    return { ok: false, reason: "error" };
  }
};
