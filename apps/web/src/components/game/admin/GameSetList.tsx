/**
 * Shared GameSet management list for both authoring surfaces (platform + college
 * via the injected adapter). Lists sets with published state, game count, and an
 * AI-drafted badge; create / edit / publish-unpublish / delete (drafts only).
 * When the adapter exposes `templates`/`clone` (college), a prominent
 * "Start from a template" section lets the operator clone a published platform
 * set — the least-effort path most colleges take.
 */
import type { GameSetListItem } from "@codeapt/shared";
import { Gamepad2, Sparkles } from "lucide-react";
import { useState } from "react";

import { parseApiError } from "../../../lib/api-client.js";
import type { GameAuthoringApi } from "../../../lib/game-authoring-api.js";
import { useQuery } from "../../../lib/use-query.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { EmptyState } from "../../ui/empty-state.js";
import { Skeleton } from "../../ui/skeleton.js";

export function GameSetList({
  authApi,
  onNew,
  onEdit,
  onResults,
}: {
  authApi: GameAuthoringApi;
  onNew: () => void;
  onEdit: (id: string) => void;
  /** Optional (college surface): open the cohort results/attempts for a set. */
  onResults?: (id: string) => void;
}): JSX.Element {
  const { data, loading, error, refetch } = useQuery(() => authApi.list(), [authApi]);
  const templates = useQuery(
    () => (authApi.templates ? authApi.templates() : Promise.resolve({ items: [] })),
    [authApi],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<unknown>): Promise<void> {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      refetch();
    } catch (err) {
      setActionError(parseApiError(err).message);
    } finally {
      setBusyId(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Game sets</h1>
        <Button size="sm" onClick={onNew}>
          New set
        </Button>
      </div>

      {actionError ? <Alert variant="error">{actionError}</Alert> : null}

      {/* Start from a template (college surface only). */}
      {authApi.templates && (templates.data?.items.length ?? 0) > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="text-sm font-semibold text-ink">Start from a template</h2>
            <p className="text-xs text-ink-muted">
              Clone a published platform set into your college, then edit and target it.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.data!.items.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border border-subtle bg-surface-base px-3 py-2"
                >
                  <span className="truncate text-sm text-ink">
                    {t.title}{" "}
                    <span className="text-ink-muted">· {t.gameCount} games</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busyId === t.id}
                    onClick={() =>
                      void run(t.id, async () => {
                        const copy = await authApi.clone!(t.id, `${t.title} (copy)`);
                        onEdit(copy.id);
                      })
                    }
                  >
                    Clone
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No game sets yet"
          description="Create one, clone a template, or draft one with AI."
          icon={<Gamepad2 />}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((s: GameSetListItem) => (
            <li key={s.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">{s.title}</span>
                      <Badge variant={s.isPublished ? "success" : "neutral"}>
                        {s.isPublished ? "Published" : "Draft"}
                      </Badge>
                      {s.source === "ai_drafted" ? (
                        <Badge variant="info" title="Drafted with AI">
                          <Sparkles className="mr-1 h-3 w-3" /> AI
                        </Badge>
                      ) : null}
                    </div>
                    <span className="text-xs text-ink-muted">
                      {s.gameCount} games · {s.selectionMode === "random_n_of_pool" ? "random pick" : "fixed order"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => onEdit(s.id)}>
                      Edit
                    </Button>
                    {onResults ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onResults(s.id)}
                      >
                        Results
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant={s.isPublished ? "ghost" : "primary"}
                      loading={busyId === s.id}
                      onClick={() =>
                        void run(s.id, () => authApi.setPublished(s.id, !s.isPublished))
                      }
                    >
                      {s.isPublished ? "Unpublish" : "Publish"}
                    </Button>
                    {!s.isPublished ? (
                      confirmId === s.id ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          loading={busyId === s.id}
                          onClick={() =>
                            void run(s.id, () => authApi.remove(s.id)).then(() => setConfirmId(null))
                          }
                        >
                          Confirm delete
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setConfirmId(s.id)}>
                          Delete
                        </Button>
                      )
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
