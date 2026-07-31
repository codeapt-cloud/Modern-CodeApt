/**
 * Worker gateway wiring. Same shape as the API's: load providers from the DB →
 * shared pure router with real adapters + usage/cooldown persistence, installed
 * behind the shared `callLlmChatJson` seam. Once installed, essay grading (which
 * calls the seam with `{kind:'grading', sensitive:true}`) routes through the
 * multi-provider router — stable-provider-first, failover, excluding providers
 * that train on data — and gains the same token optimizations as the API:
 * response caching (identical submission → cached verdict, zero tokens), a
 * right-sized output cap, and per-day usage rollups for the trend charts.
 *
 * Guarded by `ENCRYPTION_KEY`: without it the gateway stays OFF and the essay
 * grader keeps its single-provider fallback (same posture as the API).
 */
import {
  adapterFor,
  computePoolHeadroom,
  governorDecision,
  parseLlmJson,
  registerLlmRouter,
  resolveMaxTokens,
  routeChatJson,
  type AdapterUsage,
  type ChatMessage,
  type LlmTaskPolicy,
} from "@codeapt/shared";

import { isEncryptionConfigured } from "../crypto.js";
import { logger } from "../logger.js";
import { reserveCredits, refundCredits } from "../ai-credit.js";
import {
  reserveStudentCredits,
  refundStudentCredits,
} from "../student-ai-credit.js";
import { getGovernorConfig } from "../ai-governor.js";
import { cacheGet, cacheKey, cacheSet, isCacheable } from "./cache.js";
import { recordFailure, recordSuccess } from "./persist.js";
import { loadProviderRuntimes } from "./provider-source.js";
import { recordCacheHit, recordProviderUsage } from "./usage-rollup.js";

export async function gatewayCallLlmChatJson(
  systemPrompt: string,
  userPrompt: string,
  policy?: LlmTaskPolicy,
): Promise<unknown | null> {
  if (!isEncryptionConfigured()) return null;
  const now = Date.now();
  const kind = policy?.kind ?? "generation";
  const feature = policy?.feature ?? kind;
  const maxTokens = resolveMaxTokens(policy);
  const cacheable = isCacheable(policy);
  const key = cacheable ? cacheKey(kind, systemPrompt, userPrompt, maxTokens) : null;

  if (key) {
    const hit = await cacheGet(key, now);
    if (hit) {
      await recordCacheHit(feature, hit.tokens, now);
      return hit.value;
    }
  }

  const providers = (await loadProviderRuntimes(now)).map((p) => ({ ...p, maxTokens }));
  if (providers.length === 0) return null;

  // AI CREDITS (Stage 1 + per-student): atomic reserve BEFORE calling a provider;
  // exhausted → null (grading degrades to deterministic). Mirrors the API glue.
  //   • PER-STUDENT (policy.userId set → distribution on): charge the STUDENT's
  //     own allocation ONLY — the pool was committed at allocation time, so it is
  //     NOT debited again (no double-charge). No allocation → graceful gate.
  //   • Otherwise: charge the COLLEGE pool (Stage-1, unchanged). Platform calls
  //     (no collegeId) are not metered.
  const collegeId = policy?.collegeId;
  const studentMeter =
    policy?.userId && collegeId
      ? { collegeId, studentId: policy.userId }
      : null;
  if (studentMeter) {
    const reserved = await reserveStudentCredits(
      studentMeter.collegeId,
      studentMeter.studentId,
      feature,
      new Date(now),
    );
    if (!reserved) return null;
  } else if (collegeId) {
    const reserved = await reserveCredits(collegeId, feature, new Date(now));
    if (!reserved) return null;
  }

  // AI GOVERNOR (Stage 2): the GLOBAL pool gate, mirroring the API glue. The
  // worker only makes PLATFORM (daily-challenge) or INTERACTIVE (grading) calls —
  // both protected — so this sheds only when the pool is genuinely empty. There
  // is no DEFERRABLE college generation here, so nothing is enqueued to the paced
  // queue from the worker (that originates in the API). Paced re-runs set
  // `internalPaced` to skip this and run-or-fail.
  if (!policy?.internalPaced) {
    const decision = governorDecision({
      headroom: computePoolHeadroom(providers),
      config: await getGovernorConfig(),
      isPlatform: !collegeId,
      kind,
    });
    if (decision.action === "shed") {
      if (studentMeter) {
        await refundStudentCredits(
          studentMeter.collegeId,
          studentMeter.studentId,
          feature,
          new Date(now),
        );
      } else if (collegeId) {
        await refundCredits(collegeId, feature, new Date(now));
      }
      return null;
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let winner: { id: string; usage: AdapterUsage } | null = null;
  const result = await routeChatJson({
    providers,
    policy,
    now,
    callAdapter: (p) => adapterFor(p.kind).chatJson(p, messages),
    onSuccess: (p, usage) => {
      winner = { id: p.id, usage };
      return recordSuccess(p.id, usage, now);
    },
    onFailure: (p, cooldownUntil, err) => recordFailure(p.id, cooldownUntil, now, err.message),
    parse: parseLlmJson,
  });

  if (result !== null && winner !== null) {
    const w: { id: string; usage: AdapterUsage } = winner;
    await recordProviderUsage(w.id, feature, w.usage, cacheable, now);
    if (key) await cacheSet(key, kind, feature, result, w.usage, now);
  } else if (studentMeter) {
    // Providers all failed after we reserved → REFUND (debit only on success).
    await refundStudentCredits(
      studentMeter.collegeId,
      studentMeter.studentId,
      feature,
      new Date(now),
    );
  } else if (collegeId) {
    await refundCredits(collegeId, feature, new Date(now));
  }
  return result;
}

export function installLlmGateway(): void {
  if (!isEncryptionConfigured()) {
    logger.info("LLM gateway disabled (ENCRYPTION_KEY unset) — single-provider fallback");
    return;
  }
  registerLlmRouter((system, user, policy) => gatewayCallLlmChatJson(system, user, policy));
  logger.info("LLM gateway installed behind callLlmChatJson (worker)");
}
