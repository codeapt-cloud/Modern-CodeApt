/**
 * Stage-2 GLOBAL POOL GOVERNOR panel (on the super-admin AI-providers page).
 * Shows live, REAL combined-pool headroom, the reserve / platform-reserve floors,
 * whether shedding is currently active, and the paced-queue depth — and lets the
 * super-admin tune the reserve floors + shed threshold + on/off switch. Every
 * number comes from the provider health counters; nothing is fabricated.
 */
import type { AiGovernorView } from "@codeapt/shared";
import { Layers, ShieldCheck, Waves } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Progress } from "../../components/ui/progress.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Switch } from "../../components/ui/switch.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p> : null}
    </Card>
  );
}

export function GovernorPanel() {
  const { toast } = useToast();
  const query = useQuery(() => api.adminAiProviders.getGovernor(), []);
  const view: AiGovernorView | undefined = query.data ?? undefined;

  const [enabled, setEnabled] = useState(true);
  const [reserve, setReserve] = useState("20");
  const [platformReserve, setPlatformReserve] = useState("10");
  const [shed, setShed] = useState("30");
  const [saving, setSaving] = useState(false);

  // Seed the editable fields from the loaded config (once it arrives).
  useEffect(() => {
    if (!view) return;
    setEnabled(view.config.enabled);
    setReserve(String(view.config.reservePercent));
    setPlatformReserve(String(view.config.platformReservePercent));
    setShed(String(view.config.shedThreshold));
  }, [view]);

  const save = async (): Promise<void> => {
    const r = Number(reserve);
    const pr = Number(platformReserve);
    const s = Number(shed);
    if (![r, pr, s].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
      toast({ variant: "error", title: "Percentages must be between 0 and 100" });
      return;
    }
    if (pr > r) {
      toast({ variant: "error", title: "Platform reserve must be ≤ reserve" });
      return;
    }
    setSaving(true);
    try {
      await api.adminAiProviders.setGovernor({
        enabled,
        reservePercent: r,
        platformReservePercent: pr,
        shedThreshold: s,
      });
      toast({ variant: "success", title: "Governor updated" });
      query.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setSaving(false);
    }
  };

  if (query.loading) return <Skeleton className="h-56 w-full rounded-2xl" />;
  if (query.error) return <Alert variant="error">{query.error}</Alert>;
  if (!view) return null;

  const dayPct = Math.round(view.headroom.dayFraction * 100);
  const minutePct = Math.round(view.headroom.minuteFraction * 100);

  return (
    <Card className="space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-ink">Pool governor</h2>
        <span className="text-xs text-ink-muted">
          protects the shared free-tier pool across all colleges
        </span>
        <span className="ml-auto flex items-center gap-2">
          {!view.config.enabled ? (
            <Badge variant="neutral">Off</Badge>
          ) : view.sheddingActive ? (
            <Badge variant="warning">Shedding active</Badge>
          ) : (
            <Badge variant="success">Healthy</Badge>
          )}
        </span>
      </div>

      {view.providerCount === 0 ? (
        <Alert variant="info">
          No enabled, keyed providers yet — add a provider key above and the live
          pool headroom will appear here.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Pool headroom (today)"
          value={`${dayPct}%`}
          hint={
            view.headroom.combinedDayLimit > 0
              ? `${view.headroom.combinedDayRemaining.toLocaleString()} / ${view.headroom.combinedDayLimit.toLocaleString()} left`
              : "no daily limits documented"
          }
        />
        <Stat label="Headroom (this minute)" value={`${minutePct}%`} />
        <Stat
          label="Paced queue"
          value={view.pacedQueueDepth.toLocaleString()}
          hint={`drains ≤ ${view.pacedMaxPerMinute}/min`}
        />
        <Stat label="Providers in pool" value={String(view.providerCount)} />
      </div>

      {/* Headroom bar with the reserve floors marked. */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span className="flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" /> Combined daily headroom
          </span>
          <span>
            reserve {view.config.reservePercent}% · platform{" "}
            {view.config.platformReservePercent}% · shed &lt;{" "}
            {view.config.shedThreshold}%
          </span>
        </div>
        <Progress value={dayPct} />
        <p className="text-[11px] text-ink-muted">
          {view.sheddingActive
            ? "Below the shed threshold — non-urgent college AI (generation / AI Build) is being deferred to the paced queue; interactive grading and platform jobs still run."
            : "Above the shed threshold — all AI runs normally. Deferrable college AI is paced only when headroom drops below the threshold."}
        </p>
      </div>

      {/* Config knobs */}
      <div className="space-y-3 border-t border-subtle pt-4">
        <div className="flex items-center gap-2">
          <Waves className="h-4 w-4 text-ink-muted" />
          <h3 className="text-sm font-medium text-ink">Tuning</h3>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          Governor enabled
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-muted">
              Reserve % (deferrable floor)
            </label>
            <Input
              type="number"
              min={0}
              max={100}
              value={reserve}
              onChange={(e) => setReserve(e.target.value)}
              aria-label="Reserve percent"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-muted">
              Platform reserve % (grading floor)
            </label>
            <Input
              type="number"
              min={0}
              max={100}
              value={platformReserve}
              onChange={(e) => setPlatformReserve(e.target.value)}
              aria-label="Platform reserve percent"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-muted">
              Shed threshold %
            </label>
            <Input
              type="number"
              min={0}
              max={100}
              value={shed}
              onChange={(e) => setShed(e.target.value)}
              aria-label="Shed threshold percent"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save governor"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
