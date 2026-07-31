/**
 * The DB-backed gateway: the function installed behind the `callLlmChatJson`
 * seam. It loads provider runtimes from the DB, then hands them to the SHARED
 * pure router with the real HTTP adapters + usage/cooldown persistence. Returns
 * the parsed JSON object or null — graceful exhaustion, never throws.
 *
 * Token optimization (Prompt 3): every call is (a) served from the RESPONSE
 * CACHE when an identical request was seen before (zero tokens), (b) given a
 * right-sized `max_tokens` from the task policy, and (c) recorded into per-day
 * usage rollups for the admin trend charts. None of this changes the seam's
 * contract or any caller.
 *
 * Off-switch: if `ENCRYPTION_KEY` is unset or no usable provider exists, it
 * returns null, which every AI feature already treats as "AI unavailable".
 */
import {
  adapterFor,
  computePoolHeadroom,
  governorDecision,
  parseLlmJson,
  resolveMaxTokens,
  routeChatJson,
  type AdapterUsage,
  type ChatMessage,
  type LlmTaskPolicy,
} from "@codeapt/shared";

import { isEncryptionConfigured } from "../crypto.js";
import { reserveCredits, refundCredits } from "../../services/ai-credit.service.js";
import {
  reserveStudentCredits,
  refundStudentCredits,
} from "../../services/student-ai-credit.service.js";
import { getGovernorConfig } from "../../services/ai-governor.service.js";
import { cacheGet, cacheKey, cacheSet, isCacheable } from "./cache.js";
import { enqueuePacedAiJob } from "../execution-queue.js";
import { loadProviderRuntimes } from "./provider-source.js";
import { recordFailure, recordSuccess } from "./persist.js";
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

  // 1) Cache hit → return the stored result at ZERO tokens (recorded as saved).
  if (key) {
    const hit = await cacheGet(key, now);
    if (hit) {
      await recordCacheHit(feature, hit.tokens, now);
      return hit.value;
    }
  }

  // 2) Miss → route through providers (right-sized output budget applied).
  const providers = (await loadProviderRuntimes(now)).map((p) => ({ ...p, maxTokens }));
  if (providers.length === 0) return null;

  // 2a) AI CREDITS (Stage 1 + per-student): atomically reserve the action's credit
  // weight BEFORE hitting a provider. Exhausted → return null (the same "AI
  // unavailable" signal features already degrade on). Platform calls (no collegeId)
  // are not metered.
  //   • PER-STUDENT (policy.userId set → the college runs distribution): reserve
  //     the STUDENT's own allocation ONLY. The college pool was already committed
  //     to the student at allocation time, so it is NOT debited again here (no
  //     double-charge). No allocation / exhausted → graceful gate.
  //   • Otherwise (college-initiated, or distribution off): reserve the college
  //     pool exactly as Stage-1 always did (unchanged).
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

  // 2b) AI GOVERNOR (Stage 2): the GLOBAL free-tier pool gate. AFTER the Stage-1
  // per-college reserve, BEFORE calling a provider. Protects platform-critical
  // jobs (reserved headroom), protects interactive grading from shedding, and
  // sheds/defers only non-urgent (deferrable) college AI when the shared pool is
  // low. The paced worker sets `internalPaced` to skip this (it IS the paced run).
  if (!policy?.internalPaced) {
    const decision = governorDecision({
      headroom: computePoolHeadroom(providers),
      config: await getGovernorConfig(),
      isPlatform: !collegeId,
      kind,
    });
    if (decision.action === "shed") {
      // Release whichever ledger we reserved — no provider call will happen.
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
      // Deferrable + cacheable → pace it so a retry becomes a cheap cache hit.
      if (decision.tier === "deferrable" && key) {
        try {
          await enqueuePacedAiJob(
            { system: systemPrompt, user: userPrompt, policy: { ...policy } },
            key,
          );
        } catch {
          // Redis hiccup → the caller still degrades gracefully (try-later).
        }
      }
      return null;
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // Capture the winning provider + its usage (last 2xx that parsed → the result).
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
    onFailure: (p, cooldownUntil, err) =>
      recordFailure(p.id, cooldownUntil, now, err.message),
    parse: parseLlmJson,
  });

  // 3) On success: record the rollup + cache the result (never cache errors).
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
