/**
 * PURE presentation helpers for the unified attempt-history page (labels, badge
 * variants, module filtering, essay deep-links). Kept DOM-free so the mapping is
 * unit-tested in the node web suite; the React component (components/history/
 * AttemptHistory.tsx) is a thin renderer over these.
 */
import { HistoryModule, HistoryStatus, type HistoryEntry } from "@codeapt/shared";

/** Human label for a module (the row's small caption + the filter tab). */
export function moduleLabel(module: HistoryEntry["module"]): string {
  switch (module) {
    case HistoryModule.EXAM:
      return "Exam";
    case HistoryModule.SPEAKING:
      return "Speaking";
    case HistoryModule.COMMUNICATION:
      return "Communication";
    case HistoryModule.ESSAY:
      return "Essay";
    case HistoryModule.GAME:
      return "Game";
    default:
      return module;
  }
}

/** Badge variant + label for a normalized status (variants from ui/badge). */
export function statusBadge(status: HistoryEntry["status"]): {
  label: string;
  variant: "success" | "error" | "warning" | "info" | "neutral";
} {
  switch (status) {
    case HistoryStatus.GRADED:
      return { label: "Graded", variant: "success" };
    case HistoryStatus.GRADING:
      return { label: "Grading", variant: "info" };
    case HistoryStatus.IN_PROGRESS:
      return { label: "In progress", variant: "neutral" };
    case HistoryStatus.EXPIRED:
      return { label: "Expired", variant: "warning" };
    case HistoryStatus.ABANDONED:
      return { label: "Abandoned", variant: "neutral" };
    case HistoryStatus.TERMINATED:
      return { label: "Ended — flagged", variant: "error" };
    default:
      return { label: status, variant: "neutral" };
  }
}

export type HistoryFilter = "all" | HistoryEntry["module"];

/** The filter tabs, in display order. */
export const HISTORY_FILTERS: readonly HistoryFilter[] = [
  "all",
  HistoryModule.EXAM,
  HistoryModule.SPEAKING,
  HistoryModule.COMMUNICATION,
  HistoryModule.ESSAY,
  HistoryModule.GAME,
];

export function filterLabel(filter: HistoryFilter): string {
  return filter === "all" ? "All" : moduleLabel(filter);
}

/** Entries for one filter (order preserved — the server already date-sorts). */
export function filterEntries(
  entries: readonly HistoryEntry[],
  filter: HistoryFilter,
): HistoryEntry[] {
  return filter === "all"
    ? [...entries]
    : entries.filter((e) => e.module === filter);
}

/** Count per filter, so a tab can show "Exam (3)" and hide empty modules. */
export function moduleCounts(
  entries: readonly HistoryEntry[],
): Record<HistoryFilter, number> {
  const counts = { all: entries.length } as Record<HistoryFilter, number>;
  for (const f of HISTORY_FILTERS) {
    if (f !== "all") counts[f] = entries.filter((e) => e.module === f).length;
  }
  return counts;
}

/**
 * A deep link to review an entry, or null when the module has no standalone
 * review route (exam/speaking/game scores are shown inline). `surface`/`slug`
 * pick the college vs B2C URL — the essay writer keys the tenant off `?c=`.
 */
export function historyEntryHref(
  entry: HistoryEntry,
  surface: "college" | "b2c",
  slug?: string,
): string | null {
  const c = surface === "college" && slug ? `?c=${encodeURIComponent(slug)}` : "";
  switch (entry.module) {
    case HistoryModule.ESSAY:
      return entry.assessmentId ? `/essays/${entry.assessmentId}${c}` : null;
    case HistoryModule.COMMUNICATION:
      return entry.assessmentId
        ? surface === "college" && slug
          ? `/c/${slug}/communication/assessments/${entry.assessmentId}`
          : `/communication/${entry.assessmentId}`
        : null;
    default:
      return null;
  }
}

/** Short, locale-agnostic date for a row ("26 Aug 2026"), or "" when absent. */
export function historyDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
