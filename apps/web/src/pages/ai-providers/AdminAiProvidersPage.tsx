/**
 * Super-admin LLM gateway console (/admin/ai-providers). Turns the idle gateway
 * ON (add encrypted keys) and makes it observable (live per-provider usage vs
 * limits, status, cooldown, reliability, last error). Every number is REAL
 * (from the gateway health counters). The key is entered masked and encrypted
 * server-side — it is never shown back.
 */
import {
  AiProviderStatus,
  type AiProviderAdmin,
  type UsageTrendsResponse,
} from "@codeapt/shared";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  FlaskConical,
  Gauge,
  KeyRound,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { Input } from "../../components/ui/input.js";
import { Progress } from "../../components/ui/progress.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Switch } from "../../components/ui/switch.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import {
  cooldownRemaining,
  reorderSwap,
  statusLabel,
  statusVariant,
  usagePercent,
} from "../../lib/ai-providers-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { GovernorPanel } from "./GovernorPanel.js";

function HeadroomBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number | null;
}) {
  const pct = usagePercent(used, limit);
  if (pct === null) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span>{label}</span>
        <span>
          {used.toLocaleString()} / {limit!.toLocaleString()}
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </Card>
  );
}

/** Compact number for tight labels (1234 → "1.2k", 1_200_000 → "1.2M"). */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function TrendTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p> : null}
    </Card>
  );
}

/** Lightweight CSS bar chart of daily token consumption (no charting dep). */
function DailyTokenBars({ trends }: { trends: UsageTrendsResponse }) {
  const points = trends.byDay.map((d) => ({
    date: d.date,
    tokens: d.promptTokens + d.completionTokens,
    cacheHits: d.cacheHits,
    saved: d.tokensSaved,
  }));
  const max = Math.max(1, ...points.map((p) => p.tokens));
  const hasData = points.some((p) => p.tokens > 0 || p.cacheHits > 0);
  if (!hasData) {
    return (
      <p className="py-8 text-center text-sm text-ink-muted">
        No AI usage recorded yet. Run essay grading, keyword generation, or AI Build
        and the daily consumption + cache savings will appear here.
      </p>
    );
  }
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {points.map((p) => (
          <div
            key={p.date}
            className="flex flex-1 flex-col justify-end"
            title={`${p.date}: ${p.tokens.toLocaleString()} tokens · ${p.cacheHits} cache hit(s) · ${p.saved.toLocaleString()} saved`}
          >
            <div
              className="w-full rounded-t bg-primary/80 transition-[height] duration-500"
              style={{ height: `${Math.max(p.tokens > 0 ? 4 : 0, Math.round((p.tokens / max) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-muted">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function UsageTrends({ trends }: { trends: UsageTrendsResponse }) {
  const { cache, totals, byFeature, byProvider, windowDays } = trends;
  const totalTokens = totals.promptTokens + totals.completionTokens;
  return (
    <Card className="space-y-5 p-4">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-ink">Usage trends</h2>
        <span className="text-xs text-ink-muted">
          last {windowDays} days · real consumption + cache savings
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TrendTile label="Tokens used" value={compact(totalTokens)} hint={`${totals.requests.toLocaleString()} provider calls`} />
        <TrendTile
          label="Cache hit-rate"
          value={`${Math.round(cache.hitRate * 100)}%`}
          hint={`${cache.hits.toLocaleString()} hits · ${cache.misses.toLocaleString()} misses`}
        />
        <TrendTile label="Tokens saved" value={compact(cache.tokensSaved)} hint="by cache hits (zero-cost)" />
        <TrendTile label="Cache hits" value={compact(cache.hits)} hint="identical requests reused" />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-ink-muted">Tokens per day</p>
        <DailyTokenBars trends={trends} />
      </div>

      {byFeature.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-muted">By feature</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="py-1 pr-4 font-medium">Feature</th>
                  <th className="py-1 pr-4 font-medium">Calls</th>
                  <th className="py-1 pr-4 font-medium">Tokens</th>
                  <th className="py-1 pr-4 font-medium">Cache hits</th>
                  <th className="py-1 font-medium">Saved</th>
                </tr>
              </thead>
              <tbody className="text-ink">
                {byFeature.map((f) => (
                  <tr key={f.feature} className="border-t border-subtle">
                    <td className="py-1 pr-4 font-mono text-xs">{f.feature}</td>
                    <td className="py-1 pr-4">{f.requests.toLocaleString()}</td>
                    <td className="py-1 pr-4">{f.tokens.toLocaleString()}</td>
                    <td className="py-1 pr-4">{f.cacheHits.toLocaleString()}</td>
                    <td className="py-1">{f.tokensSaved.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {byProvider.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-muted">By provider</p>
          <div className="space-y-1">
            {byProvider.map((p) => {
              const max = Math.max(1, ...byProvider.map((x) => x.tokens));
              return (
                <div key={p.providerId} className="flex items-center gap-2 text-xs">
                  <span className="w-40 shrink-0 truncate text-ink">{p.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.round((p.tokens / max) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-ink-muted">
                    {p.tokens.toLocaleString()} tok
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function AdminAiProvidersPage() {
  const { toast } = useToast();
  const listQuery = useQuery(() => api.adminAiProviders.list(), []);
  const trendsQuery = useQuery(() => api.adminAiProviders.usageTrends(14), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [keyDialogFor, setKeyDialogFor] = useState<AiProviderAdmin | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [editFor, setEditFor] = useState<AiProviderAdmin | null>(null);
  const [editModel, setEditModel] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message?: string }>
  >({});

  const providers = listQuery.data?.providers ?? [];
  const summary = listQuery.data?.summary;
  const encryptionOff = summary ? !summary.encryptionConfigured : false;
  const now = Date.now();

  /** Runs an action; returns true on success, false (with an error toast) on failure. */
  const run = async (id: string, fn: () => Promise<unknown>): Promise<boolean> => {
    setBusyId(id);
    try {
      await fn();
      listQuery.refetch();
      return true;
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const reorder = (p: AiProviderAdmin, dir: "up" | "down"): void => {
    const swap = reorderSwap(providers, p.id, dir);
    if (!swap) return;
    void run(p.id, () =>
      Promise.all([
        api.adminAiProviders.patch(swap.a.id, { priority: swap.a.priority }),
        api.adminAiProviders.patch(swap.b.id, { priority: swap.b.priority }),
      ]),
    );
  };

  const saveKey = async (): Promise<void> => {
    if (!keyDialogFor || !keyInput.trim()) return;
    const id = keyDialogFor.id;
    const ok = await run(id, () => api.adminAiProviders.setKey(id, keyInput.trim()));
    if (!ok) return; // the error toast already fired; keep the dialog open to retry
    toast({ variant: "success", title: "Key saved (encrypted)" });
    setKeyDialogFor(null);
    setKeyInput("");
  };

  const openEdit = (p: AiProviderAdmin): void => {
    setEditFor(p);
    setEditModel(p.model);
    setEditBaseUrl(p.baseUrl);
  };

  const saveEdit = async (): Promise<void> => {
    if (!editFor || !editModel.trim() || !editBaseUrl.trim()) return;
    const id = editFor.id;
    const ok = await run(id, () =>
      api.adminAiProviders.patch(id, {
        model: editModel.trim(),
        baseUrl: editBaseUrl.trim(),
      }),
    );
    if (!ok) return;
    toast({ variant: "success", title: "Provider updated" });
    setEditFor(null);
  };

  const test = (p: AiProviderAdmin): void => {
    void run(p.id, async () => {
      const res = await api.adminAiProviders.test(p.id);
      setTestResults((prev) => ({
        ...prev,
        [p.id]: { ok: res.ok, message: res.ok ? "Key works" : res.message },
      }));
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI providers"
        description="Manage the multi-provider LLM gateway that powers essay grading, keywords, and AI Test Builder. Add keys to turn a provider on; watch live usage, headroom, and failover."
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              listQuery.refetch();
              trendsQuery.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Providers" value={summary.total} />
          <StatCard label="Enabled" value={summary.enabled} />
          <StatCard label="Keyed" value={summary.keyed} />
          <StatCard label="Available now" value={summary.available} />
        </div>
      ) : null}

      {trendsQuery.data ? <UsageTrends trends={trendsQuery.data} /> : null}

      <GovernorPanel />

      {encryptionOff ? (
        <Alert variant="warning">
          Provider keys can't be stored yet — the server has no{" "}
          <span className="font-mono">ENCRYPTION_KEY</span> set, so the gateway is
          off. Set it (see <span className="font-mono">.env.example</span>) and
          restart the API, then add keys here.
        </Alert>
      ) : null}

      {listQuery.loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : listQuery.error ? (
        <Alert variant="error">{listQuery.error}</Alert>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => {
            const cd = cooldownRemaining(p.health.cooldownUntil, now);
            const test_ = testResults[p.id];
            return (
              <Card key={p.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-ink">{p.name}</h3>
                      <Badge variant={statusVariant(p.health.status)}>
                        {statusLabel(p.health.status)}
                        {p.health.status === AiProviderStatus.COOLING_DOWN && cd
                          ? ` · ${cd}`
                          : ""}
                      </Badge>
                      <Badge variant="neutral">{p.capability}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-ink-muted">
                      {p.kind} · {p.model}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton
                      aria-label="Edit model / base URL"
                      variant="ghost"
                      size="sm"
                      icon={<Pencil className="h-4 w-4" />}
                      disabled={busyId === p.id}
                      onClick={() => openEdit(p)}
                    />
                    <IconButton
                      aria-label="Move up (higher priority)"
                      variant="ghost"
                      size="sm"
                      icon={<ArrowUp className="h-4 w-4" />}
                      disabled={busyId === p.id}
                      onClick={() => reorder(p, "up")}
                    />
                    <span className="w-8 text-center text-xs text-ink-muted">
                      #{p.priority}
                    </span>
                    <IconButton
                      aria-label="Move down (lower priority)"
                      variant="ghost"
                      size="sm"
                      icon={<ArrowDown className="h-4 w-4" />}
                      disabled={busyId === p.id}
                      onClick={() => reorder(p, "down")}
                    />
                  </div>
                </div>

                {/* Toggles */}
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <Switch
                      checked={p.enabled}
                      disabled={busyId === p.id}
                      onCheckedChange={(v) =>
                        void run(p.id, () =>
                          api.adminAiProviders.patch(p.id, { enabled: v }),
                        )
                      }
                    />
                    Enabled
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <Switch
                      checked={p.trainsOnData}
                      disabled={busyId === p.id}
                      onCheckedChange={(v) =>
                        void run(p.id, () =>
                          api.adminAiProviders.patch(p.id, { trainsOnData: v }),
                        )
                      }
                    />
                    <span className="inline-flex items-center gap-1">
                      Trains on data
                      {p.trainsOnData ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-warning-fg"
                          title="This provider may train on prompts — excluded for sensitive/student data (e.g. essay grading)."
                        >
                          <ShieldAlert className="h-3.5 w-3.5" /> avoid for student data
                        </span>
                      ) : null}
                    </span>
                  </label>
                </div>

                {/* Key management */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant={p.keySet ? "success" : "neutral"}>
                    <KeyRound className="h-3.5 w-3.5" /> {p.keySet ? "Key set" : "No key"}
                  </Badge>
                  {p.keyUrl ? (
                    <Button size="sm" variant="ghost" asChild>
                      <a
                        href={p.keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={`Open ${p.name}'s console to claim a free API key`}
                      >
                        <ExternalLink className="h-4 w-4" /> Get API key
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === p.id || encryptionOff}
                    title={
                      encryptionOff
                        ? "Set ENCRYPTION_KEY on the server to store keys"
                        : undefined
                    }
                    onClick={() => {
                      setKeyDialogFor(p);
                      setKeyInput("");
                    }}
                  >
                    {p.keySet ? "Replace key" : "Add key"}
                  </Button>
                  {p.keySet ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === p.id}
                        onClick={() =>
                          void run(p.id, () => api.adminAiProviders.deleteKey(p.id))
                        }
                      >
                        <Trash2 className="h-4 w-4" /> Delete key
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === p.id}
                        onClick={() => test(p)}
                      >
                        <FlaskConical className="h-4 w-4" /> Test
                      </Button>
                      {test_ ? (
                        <span
                          className={
                            "text-xs " +
                            (test_.ok ? "text-success-fg" : "text-error-fg")
                          }
                        >
                          {test_.ok ? "✓ Key works" : `✗ ${test_.message ?? "Failed"}`}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>

                {/* Monitoring */}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <HeadroomBar
                    label="Requests today"
                    used={p.health.usage.day.requests}
                    limit={p.limits.requestsPerDay}
                  />
                  <HeadroomBar
                    label="Requests this minute"
                    used={p.health.usage.minute.requests}
                    limit={p.limits.requestsPerMinute}
                  />
                  <HeadroomBar
                    label="Tokens today"
                    used={p.health.usage.day.tokens}
                    limit={p.limits.tokensPerDay}
                  />
                  <HeadroomBar
                    label="Tokens this minute"
                    used={p.health.usage.minute.tokens}
                    limit={p.limits.tokensPerMinute}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                  <span>reliability {Math.round(p.health.reliability * 100)}%</span>
                  {p.health.lastUsedAt ? (
                    <span>last used {new Date(p.health.lastUsedAt).toLocaleString()}</span>
                  ) : null}
                  {p.health.lastError ? (
                    <span className="text-error-fg">
                      last error: {p.health.lastError}
                      {p.health.lastErrorAt
                        ? ` (${new Date(p.health.lastErrorAt).toLocaleString()})`
                        : ""}
                    </span>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/replace key dialog — masked input, encrypted server-side, never echoed */}
      <Dialog
        open={keyDialogFor !== null}
        onOpenChange={(o) => {
          if (!o) {
            setKeyDialogFor(null);
            setKeyInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {keyDialogFor?.keySet ? "Replace" : "Add"} key — {keyDialogFor?.name}
            </DialogTitle>
            <DialogDescription>
              Paste the provider API key. It is encrypted at rest and never shown
              again.
              {keyDialogFor?.keyUrl ? (
                <>
                  {" "}
                  <a
                    href={keyDialogFor.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Get one from the provider console
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  .
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoComplete="off"
            placeholder="sk-…"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            aria-label="Provider API key"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setKeyDialogFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={!keyInput.trim() || busyId === keyDialogFor?.id}
              onClick={() => void saveKey()}
            >
              Save key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit model / base URL — fixes stale or account-specific model ids
          (e.g. a retired Gemma id returning 404) without a redeploy. */}
      <Dialog
        open={editFor !== null}
        onOpenChange={(o) => {
          if (!o) setEditFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit provider — {editFor?.name}</DialogTitle>
            <DialogDescription>
              Correct the model id or base URL. Provider model ids drift and can
              vary by account — Test after saving to confirm it resolves.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-muted">Model id</label>
              <Input
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                placeholder="e.g. gemma-4-26b-a4b-it"
                aria-label="Model id"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-muted">Base URL</label>
              <Input
                value={editBaseUrl}
                onChange={(e) => setEditBaseUrl(e.target.value)}
                placeholder="https://…"
                aria-label="Base URL"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                !editModel.trim() || !editBaseUrl.trim() || busyId === editFor?.id
              }
              onClick={() => void saveEdit()}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
