/**
 * Provider selection — filter to AVAILABLE providers then order them for a task.
 *
 * Available = has a key, not in cooldown, has headroom, and (for sensitive tasks)
 * does NOT train on inputs. Ordering:
 *   - generation → priority asc, then score desc (rotate freely across the free
 *     tier, best headroom/reliability first within a priority tier).
 *   - grading    → reliability desc, then priority asc (prefer the most STABLE
 *     provider for score consistency), with the rest as fallback.
 * When `policy.capability` is set, providers MATCHING it sort ahead of the rest
 * (a preference, not a filter — everything stays available for failover): for
 * grading it applies below the reliability key (stability wins); otherwise above
 * priority. When it is unset the ordering is unchanged. Pure over the runtime
 * snapshots + `now`.
 */
import { hasHeadroom, providerScore } from "./headroom.js";
import type { LlmTaskPolicy, ProviderRuntime } from "./types.js";

/** True when the provider can be tried right now for this policy. */
export function isAvailable(
  p: ProviderRuntime,
  policy: LlmTaskPolicy | undefined,
  now: number,
): boolean {
  if (!p.apiKey) return false;
  if (p.health.cooldownUntil != null && p.health.cooldownUntil > now) return false;
  if (!hasHeadroom(p)) return false;
  // Student/user data must not reach a provider that trains on inputs.
  if (policy?.sensitive && p.trainsOnData) return false;
  return true;
}

/** The ordered candidate chain the router will try, best first. */
export function selectProviders(
  providers: readonly ProviderRuntime[],
  policy: LlmTaskPolicy | undefined,
  now: number,
): ProviderRuntime[] {
  const available = providers.filter((p) => isAvailable(p, policy, now));
  const grading = policy?.kind === "grading";
  const pref = policy?.capability;
  // -1 if a matches the preferred capability and b doesn't (a sorts first), +1
  // for the reverse, 0 when neither/both match or no preference is set.
  const byCapability = (a: ProviderRuntime, b: ProviderRuntime): number => {
    if (!pref) return 0;
    const am = a.capability === pref ? 1 : 0;
    const bm = b.capability === pref ? 1 : 0;
    return bm - am;
  };
  return available.sort((a, b) => {
    if (grading) {
      if (b.health.reliability !== a.health.reliability) {
        return b.health.reliability - a.health.reliability;
      }
      const cap = byCapability(a, b);
      if (cap !== 0) return cap;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return providerScore(b) - providerScore(a);
    }
    const cap = byCapability(a, b);
    if (cap !== 0) return cap;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return providerScore(b) - providerScore(a);
  });
}
