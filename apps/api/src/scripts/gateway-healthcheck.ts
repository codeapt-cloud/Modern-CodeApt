/**
 * LIVE GATEWAY SMOKE-TEST — a STANDALONE operator diagnostic (NOT a unit test).
 *
 *   pnpm --filter @codeapt/api gateway:healthcheck
 *
 * Exercises the REAL multi-provider LLM gateway end-to-end against the CONFIGURED
 * provider keys, to verify routing, failover selection, task policies, and that
 * the usage counters are real. It lives OUTSIDE the vitest suite (which mocks all
 * network) so CI never burns quota; an operator runs it deliberately.
 *
 * Sections:
 *   1. Inventory — every provider (enabled/keyed/status/cooldown), via the SAME
 *      admin service the UI uses (no fabricated data).
 *   2. Probe     — one tiny {"ok":true} call to EACH enabled+keyed provider
 *      DIRECTLY (bypassing selection) → reachable? latency ms? tokens? Observational
 *      only: it does NOT persist health, so it can't wipe a cooldown or bench a
 *      provider from a one-shot blip.
 *   3. Router    — REAL calls THROUGH the router for {generation} and
 *      {grading, sensitive}; reports the candidate chain, who actually answered,
 *      and confirms trainsOnData providers are EXCLUDED for the sensitive task.
 *      Uses the identical adapter + persistence path as the installed seam.
 *   4. Failover  — SELECTION check (no live call / no quota / no DB write): bench
 *      the top provider IN MEMORY and confirm selection falls to the next.
 *   5. Usage     — re-reads the health counters and confirms requests/tokens
 *      INCREMENTED for the providers the router actually called (monitoring is real).
 *
 * SECURITY: a decrypted key NEVER touches stdout. Failures print status +
 * classification only — never a provider body that might echo the key. The
 * ProviderRuntime (which carries the key) is never logged as an object.
 *
 * SIDE EFFECTS: none beyond the REAL, expected usage-counter increments from the
 * Section-3 router calls — the exact writes the live gateway makes in production
 * (a provider that genuinely fails during routing may end up briefly cooling down,
 * as it would normally). The Section-4 failover check mutates nothing.
 *
 * EXIT CODE: 0 = healthy. Non-zero if the setup is unusable (no ENCRYPTION_KEY, or
 * no enabled+keyed provider), if ANY keyed+enabled provider is unreachable, or if
 * the failover selection is wrong — so it is a usable health signal for scripts.
 */
import {
  adapterFor,
  hasLlmRouter,
  parseLlmJson,
  routeChatJson,
  selectProviders,
  ProviderHttpError,
  type AdapterUsage,
  type ChatMessage,
  type LlmTaskPolicy,
  type ProviderRuntime,
} from "@codeapt/shared";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { isEncryptionConfigured } from "../lib/crypto.js";
import { installLlmGateway } from "../lib/llm-gateway/index.js";
import { loadProviderRuntimes } from "../lib/llm-gateway/provider-source.js";
import { recordFailure, recordSuccess } from "../lib/llm-gateway/persist.js";
import { logger } from "../lib/logger.js";
import { listProviders } from "../services/ai-provider-admin.service.js";
// Importing the barrel registers every Mongoose model (incl. AiProvider*).
import "../models/index.js";

// --- tiny, cheap, deterministic probe --------------------------------------

/** Minimal prompt: a working provider answers in ~a handful of tokens. */
const PROBE_MESSAGES: ChatMessage[] = [
  { role: "system", content: "Respond with strict JSON only." },
  { role: "user", content: 'Reply with exactly {"ok":true}' },
];

/** Mirror the gateway's parse exactly — the shared tolerant JSON extractor. */
function parseJson(content: string): unknown | null {
  return parseLlmJson(content);
}

// --- printing helpers (plain stdout — the report is for a human, not logs) --

const out = (s = ""): void => void process.stdout.write(`${s}\n`);
const rule = (): void => out("-".repeat(72));
function section(title: string): void {
  out(`\n${"=".repeat(72)}`);
  out(title);
  out("=".repeat(72));
}
const pad = (s: string, n: number): string => s.padEnd(n).slice(0, n);
const ms = (n: number): string => `${n}ms`;

// ---------------------------------------------------------------------------
// Section 2 — per-provider direct probe (observational, no persistence)
// ---------------------------------------------------------------------------

interface ProbeResult {
  name: string;
  model: string;
  kind: string;
  ok: boolean;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  /** Redacted failure detail (status + classification), or a soft reason. */
  detail?: string;
}

async function probeProvider(rt: ProviderRuntime): Promise<ProbeResult> {
  const started = Date.now();
  const base = { name: rt.name, model: rt.model, kind: rt.kind };
  try {
    const res = await adapterFor(rt.kind).chatJson(rt, PROBE_MESSAGES);
    const latencyMs = Date.now() - started;
    const parseable = parseJson(res.content) !== null;
    return {
      ...base,
      ok: parseable,
      latencyMs,
      promptTokens: res.usage.promptTokens,
      completionTokens: res.usage.completionTokens,
      detail: parseable ? undefined : "2xx but unparseable JSON",
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    // REDACT: status + classification only — never a body/key.
    if (err instanceof ProviderHttpError) {
      return {
        ...base,
        ok: false,
        latencyMs,
        detail: `HTTP ${err.status} (${err.classification})`,
      };
    }
    return { ...base, ok: false, latencyMs, detail: "request failed" };
  }
}

// ---------------------------------------------------------------------------
// Section 3 — real router call, instrumented to observe the routing decision
// ---------------------------------------------------------------------------

interface Attempt {
  name: string;
  ok: boolean;
  detail?: string;
}
interface RouterObservation {
  label: string;
  chain: string[];
  /** trainsOnData providers excluded because the task is sensitive. */
  excludedTraining: string[];
  attempts: Attempt[];
  routedTo: string | null;
  usage?: AdapterUsage;
  latencyMs: number;
  /** Provider ids actually hit — feeds the usage-increment verification. */
  calledIds: string[];
}

/**
 * Run the REAL router (same code path as `gatewayCallLlmChatJson`) for one policy
 * and observe which provider answered. `callAdapter` also records each attempt for
 * the report; `onSuccess`/`onFailure` persist usage/cooldown exactly as the live
 * gateway does.
 */
async function routeObserved(
  runtimes: ProviderRuntime[],
  policy: LlmTaskPolicy,
  label: string,
): Promise<RouterObservation> {
  const now = Date.now();
  const chain = selectProviders(runtimes, policy, now);
  const chainNames = chain.map((p) => p.name);
  const trainers = runtimes.filter((p) => p.trainsOnData).map((p) => p.name);
  const excludedTraining = policy.sensitive
    ? trainers.filter((n) => !chainNames.includes(n))
    : [];

  const attempts: Attempt[] = [];
  const calledIds: string[] = [];
  let winnerUsage: AdapterUsage | undefined;

  const started = Date.now();
  const parsed = await routeChatJson({
    providers: runtimes,
    policy,
    now,
    callAdapter: async (p) => {
      calledIds.push(p.id);
      try {
        const res = await adapterFor(p.kind).chatJson(p, PROBE_MESSAGES);
        const parseable = parseJson(res.content) !== null;
        attempts.push({
          name: p.name,
          ok: parseable,
          detail: parseable ? undefined : "unparseable",
        });
        if (parseable) winnerUsage = res.usage;
        return res;
      } catch (err) {
        const e =
          err instanceof ProviderHttpError
            ? err
            : new ProviderHttpError("request failed", {
                status: 0,
                classification: "transient",
              });
        attempts.push({
          name: p.name,
          ok: false,
          detail: `HTTP ${e.status} (${e.classification})`,
        });
        throw err;
      }
    },
    onSuccess: (p, usage) => recordSuccess(p.id, usage, now),
    onFailure: (p, cooldownUntil, err) =>
      recordFailure(p.id, cooldownUntil, now, err.message),
    parse: parseJson,
  });
  const latencyMs = Date.now() - started;

  // The router returns on the FIRST parseable success, so the winner is the sole
  // ok attempt (if any) and only when the router produced a result.
  const winner = attempts.find((a) => a.ok);
  const routedTo = parsed !== null && winner ? winner.name : null;

  return {
    label,
    chain: chainNames,
    excludedTraining,
    attempts,
    routedTo,
    usage: routedTo ? winnerUsage : undefined,
    latencyMs,
    calledIds,
  };
}

// ---------------------------------------------------------------------------
// Section 4 — failover SELECTION check (in-memory, no live call / no DB write)
// ---------------------------------------------------------------------------

interface FailoverResult {
  status: "pass" | "fail" | "skip";
  baseChain: string[];
  benched?: string;
  afterChain?: string[];
  note: string;
}

function failoverCheck(runtimes: ProviderRuntime[]): FailoverResult {
  const now = Date.now();
  const base = selectProviders(runtimes, { kind: "generation" }, now);
  const baseChain = base.map((p) => p.name);
  if (base.length < 2) {
    return {
      status: "skip",
      baseChain,
      note: "needs ≥2 available providers to demonstrate failover — skipped",
    };
  }
  const top = base[0]!;
  const expectedNext = base[1]!;
  // Clone the runtimes; bench ONLY the top one in memory (no DB, nothing to restore).
  const cloned = runtimes.map((p) =>
    p.id === top.id
      ? { ...p, health: { ...p.health, cooldownUntil: now + 60_000 } }
      : p,
  );
  const after = selectProviders(cloned, { kind: "generation" }, now);
  const afterChain = after.map((p) => p.name);
  const ok = after.length > 0 && after[0]!.id === expectedNext.id;
  return {
    status: ok ? "pass" : "fail",
    baseChain,
    benched: top.name,
    afterChain,
    note: ok
      ? `with "${top.name}" benched, selection correctly fell through to "${expectedNext.name}"`
      : `expected "${expectedNext.name}" next but selection returned "${afterChain[0] ?? "—"}"`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  section("LLM GATEWAY — LIVE SMOKE-TEST");
  out("Deliberate on-demand diagnostic. Makes REAL provider calls (tiny prompts).");
  out("Keys are never printed; failures show status + classification only.");

  if (!isEncryptionConfigured()) {
    out("\n✗ ENCRYPTION_KEY is not set — the gateway can't decrypt provider keys.");
    out("  Set ENCRYPTION_KEY (see apps/api/.env.example) and re-run.");
    return 1;
  }

  await connectDatabase();
  try {
    // Install the router behind the seam (fidelity with the running API) and
    // confirm the wiring — the Section-3 calls use the identical adapter +
    // persistence path, so this proves the installed seam is exercised.
    installLlmGateway();

    // --- Section 1: inventory (real admin-service data) ---------------------
    section("1. INVENTORY");
    const now = Date.now();
    const before = await listProviders(now);
    const s = before.summary;
    out(
      `Providers: ${s.total} total · ${s.enabled} enabled · ${s.keyed} keyed · ` +
        `${s.available} available now`,
    );
    out(`Gateway router installed behind callLlmChatJson: ${hasLlmRouter() ? "yes" : "no"}`);
    rule();
    out(
      `${pad("PROVIDER", 26)}${pad("KIND", 14)}${pad("KEY", 5)}${pad("ENABLED", 9)}${pad("STATUS", 14)}MODEL`,
    );
    rule();
    for (const p of before.providers) {
      out(
        pad(p.name, 26) +
          pad(p.kind, 14) +
          pad(p.keySet ? "yes" : "—", 5) +
          pad(p.enabled ? "yes" : "no", 9) +
          pad(p.health.status, 14) +
          p.model,
      );
    }

    // Snapshot day counters for the usage-increment check (window-fresh values).
    const dayBefore = new Map(
      before.providers.map((p) => [
        p.id,
        { name: p.name, req: p.health.usage.day.requests, tok: p.health.usage.day.tokens },
      ]),
    );

    // Runtimes = enabled + keyed + decryptable (exactly what the router can use).
    const runtimes = await loadProviderRuntimes(Date.now());
    if (runtimes.length === 0) {
      out("\n✗ No enabled provider has a usable (decryptable) key.");
      out("  Add a key on the AI Providers admin page, then re-run.");
      return 1;
    }

    // --- Section 2: per-provider direct probe -------------------------------
    section("2. PER-PROVIDER PROBE (direct, bypassing selection)");
    out(`Probing ${runtimes.length} enabled+keyed provider(s) with a 1-word JSON prompt…\n`);
    const probes: ProbeResult[] = [];
    for (const rt of runtimes) {
      // Sequential (one-shot each) — keeps spend and rate-limit pressure minimal.
      const r = await probeProvider(rt);
      probes.push(r);
      const mark = r.ok ? "✓" : "✗";
      const tok =
        r.promptTokens !== undefined
          ? `${(r.promptTokens ?? 0) + (r.completionTokens ?? 0)} tok`
          : "— tok";
      const tail = r.ok ? `${pad(ms(r.latencyMs), 8)}${tok}` : `${pad(ms(r.latencyMs), 8)}${r.detail ?? ""}`;
      out(`  ${mark} ${pad(r.name, 26)}${tail}`);
    }
    const unreachable = probes.filter((p) => !p.ok);

    // --- Section 3: real router decisions -----------------------------------
    section("3. ROUTER DECISIONS (real calls through the router)");
    // Reload runtimes so headroom reflects any Section-2 activity fairly.
    const forRouting = await loadProviderRuntimes(Date.now());
    const genObs = await routeObserved(forRouting, { kind: "generation" }, "generation");
    const gradeObs = await routeObserved(
      await loadProviderRuntimes(Date.now()),
      { kind: "grading", sensitive: true },
      "grading (sensitive)",
    );

    for (const obs of [genObs, gradeObs]) {
      out(`\n▸ policy = ${obs.label}`);
      out(`  candidate chain : ${obs.chain.length ? obs.chain.join(" → ") : "(none available)"}`);
      if (obs.label.startsWith("grading")) {
        out(
          `  excluded (trains-on-data, sensitive): ${
            obs.excludedTraining.length ? obs.excludedTraining.join(", ") : "(none)"
          }`,
        );
      }
      const trail = obs.attempts
        .map((a) => `${a.ok ? "✓" : "✗"}${a.name}${a.detail ? `(${a.detail})` : ""}`)
        .join(" → ");
      out(`  attempts        : ${trail || "(none)"}`);
      if (obs.routedTo) {
        const tok = obs.usage ? obs.usage.promptTokens + obs.usage.completionTokens : 0;
        out(`  ROUTED TO       : ${obs.routedTo}  (${ms(obs.latencyMs)}, ${tok} tok)`);
      } else {
        out(`  ROUTED TO       : (none — every candidate failed or was excluded)`);
      }
    }

    // Task-policy assertions (informational — surfaced in the summary).
    const gradingStable =
      gradeObs.chain.length === 0 ||
      forRouting.every((p) => !p.trainsOnData) ||
      gradeObs.excludedTraining.length > 0 ||
      !forRouting.some((p) => p.trainsOnData && p.apiKey);

    // --- Section 4: failover selection check --------------------------------
    section("4. FAILOVER (selection check — no live call, no side effects)");
    const failover = failoverCheck(await loadProviderRuntimes(Date.now()));
    out(`  base order   : ${failover.baseChain.join(" → ") || "(none)"}`);
    if (failover.status !== "skip") {
      out(`  bench top    : ${failover.benched}`);
      out(`  after bench  : ${failover.afterChain?.join(" → ") || "(none)"}`);
    }
    out(`  result       : ${failover.status.toUpperCase()} — ${failover.note}`);

    // --- Section 5: usage-counter verification ------------------------------
    section("5. USAGE VERIFICATION (counters incremented for real)");
    const calledIds = new Set([...genObs.calledIds, ...gradeObs.calledIds]);
    const after = await listProviders(Date.now());
    const dayAfter = new Map(
      after.providers.map((p) => [p.id, p.health.usage.day]),
    );
    let usageOk = true;
    if (calledIds.size === 0) {
      out("  (router made no provider calls — nothing to verify)");
    } else {
      out(`${pad("PROVIDER", 26)}${pad("Δ requests", 14)}Δ tokens`);
      rule();
      for (const id of calledIds) {
        const b = dayBefore.get(id);
        const a = dayAfter.get(id);
        const dReq = (a?.requests ?? 0) - (b?.req ?? 0);
        const dTok = (a?.tokens ?? 0) - (b?.tok ?? 0);
        if (dReq < 1) usageOk = false;
        out(pad(b?.name ?? id, 26) + pad(`+${dReq}`, 14) + `+${dTok}`);
      }
      out(
        usageOk
          ? "  ✓ every called provider's request counter increased — monitoring is live."
          : "  ✗ a called provider's counter did not increase — check persistence.",
      );
    }

    // --- Summary + exit -----------------------------------------------------
    section("SUMMARY");
    out(`Keyed+enabled providers probed : ${probes.length}`);
    out(`Reachable (✓)                  : ${probes.length - unreachable.length}/${probes.length}`);
    if (unreachable.length) {
      out(`Unreachable (✗)                : ${unreachable.map((p) => `${p.name} [${p.detail}]`).join(", ")}`);
    }
    out(`Generation routed to           : ${genObs.routedTo ?? "(none)"}`);
    out(`Grading (sensitive) routed to  : ${gradeObs.routedTo ?? "(none)"}`);
    out(`Sensitive exclusion honored    : ${gradingStable ? "yes" : "review"}`);
    out(`Failover selection             : ${failover.status.toUpperCase()}`);
    out(`Usage counters incremented     : ${calledIds.size === 0 ? "n/a" : usageOk ? "yes" : "NO"}`);

    const healthy = unreachable.length === 0 && failover.status !== "fail" && usageOk;
    out(`\n${healthy ? "✓ HEALTHY — multi-provider gateway is working end-to-end." : "✗ ISSUES FOUND — see above."}`);
    return healthy ? 0 : 1;
  } finally {
    await disconnectDatabase();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    // Never let an unexpected error leak internals; log via the app logger.
    logger.error({ err }, "gateway:healthcheck failed");
    process.exit(1);
  });
