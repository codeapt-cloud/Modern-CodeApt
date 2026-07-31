/**
 * Pure (React-free) helpers for the super-admin AI Providers page — usage-vs-
 * limit percentages for the headroom bars, status labels/variants, and the
 * priority-swap math for the reorder arrows. Kept here so they unit-test cleanly.
 */
import { AiProviderStatus, type AiProviderAdmin } from "@codeapt/shared";

/** Percent of a limit consumed (0..100), or null when the axis has no limit. */
export function usagePercent(used: number, limit: number | null): number | null {
  if (limit == null || limit <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

export function statusLabel(status: AiProviderStatus): string {
  switch (status) {
    case AiProviderStatus.HEALTHY:
      return "Healthy";
    case AiProviderStatus.COOLING_DOWN:
      return "Cooling down";
    case AiProviderStatus.DISABLED:
      return "Disabled";
    case AiProviderStatus.NO_KEY:
    default:
      return "No key";
  }
}

export type StatusVariant = "success" | "warning" | "neutral" | "info";

export function statusVariant(status: AiProviderStatus): StatusVariant {
  switch (status) {
    case AiProviderStatus.HEALTHY:
      return "success";
    case AiProviderStatus.COOLING_DOWN:
      return "warning";
    case AiProviderStatus.NO_KEY:
      return "info";
    case AiProviderStatus.DISABLED:
    default:
      return "neutral";
  }
}

/** A short "cooling down for Nm" / "for Ns" label, or "" when not cooling. */
export function cooldownRemaining(cooldownUntil: number | null, now: number): string {
  if (cooldownUntil == null || cooldownUntil <= now) return "";
  const secs = Math.ceil((cooldownUntil - now) / 1000);
  if (secs >= 3600) return `${Math.ceil(secs / 3600)}h`;
  if (secs >= 60) return `${Math.ceil(secs / 60)}m`;
  return `${secs}s`;
}

/**
 * The two priority swaps needed to move a provider up/down one slot in the
 * priority-sorted list. Returns null at the edge (nothing to swap). Pure — the
 * caller applies the two PATCHes.
 */
export function reorderSwap(
  providers: readonly AiProviderAdmin[],
  id: string,
  dir: "up" | "down",
): { a: { id: string; priority: number }; b: { id: string; priority: number } } | null {
  const sorted = [...providers].sort((x, y) => x.priority - y.priority);
  const i = sorted.findIndex((p) => p.id === id);
  if (i === -1) return null;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= sorted.length) return null;
  const a = sorted[i]!;
  const b = sorted[j]!;
  // Swap their priority values (if equal, nudge so the move is visible).
  const pa = a.priority;
  const pb = b.priority === a.priority ? a.priority + (dir === "up" ? 1 : -1) : b.priority;
  return {
    a: { id: a.id, priority: pb },
    b: { id: b.id, priority: pa },
  };
}
