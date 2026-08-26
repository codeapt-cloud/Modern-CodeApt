/**
 * Unified attempt-history list — one presentational component for BOTH the
 * college (tenant) and B2C surfaces. Given the already-date-sorted entries from
 * the history endpoint, it renders module-filter chips + a row per attempt with
 * its score, status, and (for essay/communication) a review link. All labels,
 * variants, filtering and links come from lib/history-view (pure + tested); this
 * file only wires them to markup. A speaking row that was re-scored through
 * Whisper shows a "· Whisper" marker on its score (Step 32 tier-2 visibility).
 */
import type { HistoryEntry } from "@codeapt/shared";
import {
  ClipboardCheck,
  Gamepad2,
  MessagesSquare,
  Mic,
  PenLine,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { AttemptResultDetail } from "./AttemptResultDetail.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.js";
import { Skeleton } from "../ui/skeleton.js";
import { Stagger, StaggerItem } from "../motion/index.js";
import {
  HISTORY_FILTERS,
  filterEntries,
  filterLabel,
  historyDate,
  historyEntryHref,
  historyOpensInPlace,
  moduleCounts,
  moduleLabel,
  statusBadge,
  type HistoryFilter,
} from "../../lib/history-view.js";

const MODULE_ICON: Record<HistoryEntry["module"], LucideIcon> = {
  exam: ClipboardCheck,
  speaking: Mic,
  communication: MessagesSquare,
  essay: PenLine,
  game: Gamepad2,
};

interface Props {
  entries: HistoryEntry[];
  loading: boolean;
  error?: string | null;
  surface: "college" | "b2c";
  slug?: string;
}

export function AttemptHistory({
  entries,
  loading,
  error,
  surface,
  slug,
}: Props): JSX.Element {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  // The row whose result is open in the in-place drawer (exam/speaking/game).
  const [open, setOpen] = useState<HistoryEntry | null>(null);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    );
  }
  if (error) return <Alert variant="error">{error}</Alert>;
  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="Once you attempt an exam, speaking test, essay, or game, your scores will appear here."
        icon={<ClipboardCheck />}
      />
    );
  }

  const counts = moduleCounts(entries);
  const rows = filterEntries(entries, filter);

  return (
    <div className="space-y-4">
      {/* Module filter chips — hide a module with no attempts (keep "All"). */}
      <div className="flex flex-wrap gap-2">
        {HISTORY_FILTERS.filter((f) => f === "all" || counts[f] > 0).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              filter === f
                ? "border-primary bg-primary/10 text-primary"
                : "border-subtle text-ink-muted hover:text-ink"
            }`}
          >
            {filterLabel(f)}{" "}
            <span className="tabular-nums opacity-70">({counts[f] ?? 0})</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No attempts in this category yet" />
      ) : (
        <Stagger className="space-y-3">
          {rows.map((entry) => {
            const Icon = MODULE_ICON[entry.module] ?? ClipboardCheck;
            const badge = statusBadge(entry.status);
            const href = historyEntryHref(entry, surface, slug);
            const date = historyDate(entry.completedAt ?? entry.startedAt);
            return (
              <StaggerItem key={`${entry.module}:${entry.attemptId}`}>
                <Card className="flex items-center justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{entry.title}</p>
                      <p className="text-xs text-ink-muted">
                        {moduleLabel(entry.module)}
                        {date ? ` · ${date}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-sm text-ink">
                      {entry.scoreLabel}
                    </span>
                    {entry.flagged ? (
                      <span
                        className="text-error-fg"
                        title="This attempt was flagged for a proctoring violation"
                      >
                        <ShieldAlert className="h-4 w-4" />
                      </span>
                    ) : null}
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {historyOpensInPlace(entry.module) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOpen(entry)}
                      >
                        View
                      </Button>
                    ) : href ? (
                      <Link
                        to={href}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        View
                      </Link>
                    ) : null}
                  </div>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      {/* In-place result viewer for exam / speaking / game rows. */}
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full max-w-lg overflow-y-auto">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle>{open.title}</SheetTitle>
                <SheetDescription>
                  {moduleLabel(open.module)}
                  {historyDate(open.completedAt ?? open.startedAt)
                    ? ` · ${historyDate(open.completedAt ?? open.startedAt)}`
                    : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <AttemptResultDetail
                  entry={open}
                  surface={surface}
                  slug={slug}
                  onClose={() => setOpen(null)}
                />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
