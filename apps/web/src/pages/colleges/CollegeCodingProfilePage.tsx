/**
 * Coding profile (student space, route: /c/:slug/coding) — a student links their
 * Codeforces / LeetCode / CodeChef handles and sees the STORED per-platform
 * stats (rating, solved, rank) with an honest status per platform:
 *   - never       → "Not fetched yet" (a refresh is queued)
 *   - ok          → the numbers, with when they were last fetched
 *   - not_found   → "Handle not found — check the spelling"
 *   - error       → "Couldn't reach {platform}" (last-known numbers kept)
 *
 * Own-data-only (the backend always acts on the calling student). Feature-gated
 * on `coding_profiles`. A "Refresh now" button re-queues a fetch (rate-limited
 * server-side). Codeforces is official/reliable; LeetCode + CodeChef are
 * best-available (unofficial) — a platform being down never breaks the others.
 */
import {
  CodingFetchStatus,
  CodingPlatform,
  CollegeFeature,
  checkEntitlement,
  type CodingPlatformStat,
} from "@codeapt/shared";
import { Code2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const PLATFORM_LABEL: Record<CodingPlatform, string> = {
  [CodingPlatform.CODEFORCES]: "Codeforces",
  [CodingPlatform.LEETCODE]: "LeetCode",
  [CodingPlatform.CODECHEF]: "CodeChef",
};

/** A short, honest description of a platform's stored fetch status. */
function statusBadge(stat: CodingPlatformStat) {
  switch (stat.status) {
    case CodingFetchStatus.OK:
      return <Badge variant="success">Up to date</Badge>;
    case CodingFetchStatus.NEVER:
      return <Badge variant="neutral">Not fetched yet</Badge>;
    case CodingFetchStatus.NOT_FOUND:
      return <Badge variant="warning">Handle not found</Badge>;
    case CodingFetchStatus.ERROR:
      return <Badge variant="error">Couldn&apos;t reach platform</Badge>;
    default:
      return null;
  }
}

function StatCell({ label, value }: { label: string; value: number | string | null }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="text-lg font-bold tabular-nums text-ink">
        {value === null || value === "" ? "—" : value}
      </p>
    </div>
  );
}

function PlatformCard({ stat }: { stat: CodingPlatformStat }) {
  const stale =
    stat.status === CodingFetchStatus.ERROR || stat.status === CodingFetchStatus.NOT_FOUND;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {PLATFORM_LABEL[stat.platform]}
          </h3>
          <p className="text-xs text-ink-muted">@{stat.handle}</p>
          {!stat.verified ? (
            <p className="text-xs text-warning-fg">
              Unverified — self-reported. We haven&apos;t confirmed this handle is
              yours, so its rating is shown for your reference only and is excluded
              from the ranked leaderboard. Once handle verification is available,
              you&apos;ll verify ownership to appear on the ranking.
            </p>
          ) : null}
        </div>
        {statusBadge(stat)}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCell label="Rating" value={stat.rating} />
        <StatCell label="Max rating" value={stat.maxRating} />
        <StatCell label="Solved" value={stat.problemsSolved} />
        <StatCell label="Rank" value={stat.rank} />
      </div>
      <p className="text-xs text-ink-muted">
        {stat.status === CodingFetchStatus.NEVER
          ? "Queued for its first fetch."
          : stat.lastFetchedAt
            ? `Last checked ${new Date(stat.lastFetchedAt).toLocaleString()}`
            : "Not checked yet."}
        {stale && stat.status === CodingFetchStatus.NOT_FOUND
          ? " — double-check the handle spelling."
          : stale && stat.status === CodingFetchStatus.ERROR
            ? " — showing the last values we had."
            : ""}
      </p>
    </Card>
  );
}

export function CollegeCodingProfilePage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();
  const entitled = checkEntitlement(context.entitlements, CollegeFeature.CODING_PROFILES);

  const q = useQuery(
    () => (entitled ? api.codingProfiles.getMine(slug) : Promise.resolve(null)),
    [slug, entitled],
  );

  const [handles, setHandles] = useState({ codeforces: "", leetcode: "", codechef: "" });
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Seed the form from the loaded handles.
  useEffect(() => {
    const h = q.data?.handles;
    if (!h) return;
    setHandles({
      codeforces: h.codeforces ?? "",
      leetcode: h.leetcode ?? "",
      codechef: h.codechef ?? "",
    });
  }, [q.data]);

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader title="Coding profile" description="Link your competitive-coding handles." />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <Code2 className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">Coding profiles aren&apos;t enabled</h2>
          <p className="text-sm text-ink-muted">
            Your college hasn&apos;t enabled coding profiles.
          </p>
        </Card>
      </div>
    );
  }

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.codingProfiles.setHandles(slug, {
        codeforces: handles.codeforces.trim(),
        leetcode: handles.leetcode.trim(),
        codechef: handles.codechef.trim(),
      });
      toast({ variant: "success", title: "Handles saved — fetching your stats…" });
      q.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setSaving(false);
    }
  };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const res = await api.codingProfiles.refreshMine(slug);
      toast({
        variant: res.queued ? "success" : "info",
        title: res.queued ? "Refresh queued — check back shortly." : "Add a handle first.",
      });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setRefreshing(false);
    }
  };

  const stats = q.data?.stats ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coding profile"
        description="Link your competitive-coding handles — we fetch and keep your stats up to date."
        actions={
          <Button variant="secondary" loading={refreshing} onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh now
          </Button>
        }
      />

      {q.loading ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : q.error ? (
        <Alert variant="error">{q.error}</Alert>
      ) : (
        <>
          {/* Handle editor */}
          <Card className="space-y-4 p-5">
            <div>
              <h3 className="text-sm font-semibold text-ink">Your handles</h3>
              <p className="text-xs text-ink-muted">
                Enter your username on each platform. Leave a field blank to unlink it.
                Codeforces uses the official API; LeetCode and CodeChef are best-available.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-ink-secondary">Codeforces</span>
                <Input
                  value={handles.codeforces}
                  onChange={(e) => setHandles((h) => ({ ...h, codeforces: e.target.value }))}
                  placeholder="e.g. tourist"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-ink-secondary">LeetCode</span>
                <Input
                  value={handles.leetcode}
                  onChange={(e) => setHandles((h) => ({ ...h, leetcode: e.target.value }))}
                  placeholder="e.g. lee215"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-ink-secondary">CodeChef</span>
                <Input
                  value={handles.codechef}
                  onChange={(e) => setHandles((h) => ({ ...h, codechef: e.target.value }))}
                  placeholder="e.g. gennady"
                />
              </label>
            </div>
            <div>
              <Button loading={saving} onClick={() => void save()}>
                Save handles
              </Button>
            </div>
          </Card>

          {/* Per-platform stats */}
          {stats.length === 0 ? (
            <Alert variant="info">
              Add a handle above and save — your stats will appear here after the next fetch.
            </Alert>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {stats.map((s) => (
                <PlatformCard key={s.platform} stat={s} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
