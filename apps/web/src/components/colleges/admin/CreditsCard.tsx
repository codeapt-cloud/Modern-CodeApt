/**
 * Super-admin "AI credits" card (Stage 1) for a college in CollegeManagePage.
 * Shows the live balance for the current monthly period (allocated / consumed /
 * remaining + a per-feature breakdown) and lets the super-admin set the TIER,
 * an explicit monthly OVERRIDE (blank = use the tier formula), and RESET this
 * period's consumption. Allocation = override ?? tier.base + students × per-seat.
 * View + control only here; college_admins get a read-only readout in their
 * workspace. Numbers are the real ledger — honest "used up" is visible.
 */
import {
  AI_CREDIT_TIER_VALUES,
  type AiCreditBalance,
  type AiCreditTier,
} from "@codeapt/shared";
import { RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";
import { Button } from "../../ui/button.js";
import { Card } from "../../ui/card.js";
import { FormField } from "../../ui/form-field.js";
import { Input } from "../../ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { Skeleton } from "../../ui/skeleton.js";
import { useToast } from "../../ui/toast.js";

const TIER_LABEL: Record<string, string> = {
  free: "Free",
  standard: "Standard",
  premium: "Premium",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface-base px-3 py-2">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="font-mono text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}

export function CreditsCard({ collegeId }: { collegeId: string }) {
  const { toast } = useToast();
  const balanceQuery = useQuery(
    () => api.adminColleges.getCredits(collegeId),
    [collegeId],
  );
  const [tier, setTier] = useState<AiCreditTier>("free");
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);

  const balance: AiCreditBalance | null = balanceQuery.data ?? null;

  // Sync editor state once the balance loads.
  useEffect(() => {
    if (balance) {
      setTier(balance.tier);
      setOverride(
        balance.monthlyOverride == null ? "" : String(balance.monthlyOverride),
      );
    }
  }, [balance]);

  const save = async (reset = false): Promise<void> => {
    setBusy(true);
    try {
      const trimmed = override.trim();
      const monthlyOverride = trimmed === "" ? null : Math.max(0, Math.trunc(Number(trimmed)) || 0);
      await api.adminColleges.setCredits(collegeId, {
        tier,
        monthlyOverride,
        ...(reset ? { reset: true } : {}),
      });
      await balanceQuery.refetch();
      toast({
        variant: "success",
        title: reset ? "Credits reset for this period" : "AI credits saved",
      });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-ink">AI credits</h2>
      </div>
      <p className="mb-5 text-sm text-ink-muted">
        The monthly AI budget for this college. Allocation ={" "}
        <span className="font-mono">override ?? tier.base + students × per-seat</span>. AI
        actions (essay grading, feedback, keyword &amp; exam generation) debit it;
        cache hits are free. When it runs out, the college&apos;s AI degrades
        cleanly until the next period.
      </p>

      {balanceQuery.loading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : balanceQuery.error || !balance ? (
        <p className="text-sm text-error-fg">
          {balanceQuery.error ?? "Couldn't load the balance."}
        </p>
      ) : (
        <div className="space-y-5">
          {/* Live balance */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Allocated" value={balance.allocated} />
            <Stat label="Consumed" value={balance.consumed} />
            <Stat label="Remaining" value={balance.remaining} />
            <Stat label="Students" value={balance.studentCount} />
          </div>
          <div className="text-xs text-ink-muted">
            Period {balance.periodKey}
            {balance.remaining === 0 ? (
              <span className="ml-2 rounded-full bg-error/10 px-2 py-0.5 font-medium text-error-fg">
                Used up
              </span>
            ) : null}
          </div>

          {/* Per-feature breakdown */}
          {Object.keys(balance.byFeature).length > 0 ? (
            <div className="rounded-xl border border-subtle p-3">
              <div className="mb-2 text-xs font-medium text-ink-muted">
                This period, by feature
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(balance.byFeature).map(([feature, n]) => (
                  <span
                    key={feature}
                    className="rounded-full border border-subtle px-2.5 py-1 text-xs text-ink-secondary"
                  >
                    {feature}: <span className="font-mono">{n}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Controls */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Tier">
              <Select
                value={tier}
                onValueChange={(v) => setTier(v as AiCreditTier)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_CREDIT_TIER_VALUES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIER_LABEL[t] ?? t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              label="Monthly override"
              hint="Blank = use the tier formula."
            >
              <Input
                type="number"
                min={0}
                value={override}
                placeholder="(none)"
                disabled={busy}
                onChange={(e) => setOverride(e.target.value)}
              />
            </FormField>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void save(true)}
            >
              <RotateCcw className="h-4 w-4" /> Reset this period
            </Button>
            <Button disabled={busy} loading={busy} onClick={() => void save(false)}>
              Save credits
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
