/**
 * Coding leaderboard (admin/faculty, route: /c/:slug/coding-leaderboard) —
 * Prompt 2. Ranks students by a chosen PLATFORM + METRIC (Rating | Solved) over
 * the Prompt-1 STORED stats (read-only, no live fetching), filterable by
 * org-unit (branch/section/year) and attendance group, with client-side search
 * and an Excel export of the filtered view.
 *
 * Honest: only real `ok` stats are ranked (rank badge); linked-but-na/stale
 * students appear below as "Not ranked" with their status + freshness — never a
 * fabricated rank. Reuses the analytics dashboard's StatCard + Select + Table.
 */
import {
  CodingFetchStatus,
  CodingMetric,
  CodingPlatform,
  CollegeFeature,
  checkEntitlement,
  type CodingLeaderboardRow,
} from "@codeapt/shared";
import { BarChart3, Code2, Download, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { StatCard } from "../../components/colleges/StatCard.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Input } from "../../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const PLATFORM_LABEL: Record<CodingPlatform, string> = {
  [CodingPlatform.CODEFORCES]: "Codeforces",
  [CodingPlatform.LEETCODE]: "LeetCode",
  [CodingPlatform.CODECHEF]: "CodeChef",
};
const METRIC_LABEL: Record<CodingMetric, string> = {
  [CodingMetric.RATING]: "Rating",
  [CodingMetric.PROBLEMS_SOLVED]: "Solved",
};

const num = (v: number | null): string => (v === null ? "—" : String(v));

/** Flatten an org-unit tree into indented dropdown options. */
interface TreeNode {
  id: string;
  name: string;
  children: TreeNode[];
}
function flattenUnits(nodes: TreeNode[], depth = 0): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, label: `${"  ".repeat(depth)}${n.name}` });
    if (n.children?.length) out.push(...flattenUnits(n.children, depth + 1));
  }
  return out;
}

/** A tiny per-platform stat chip: "1500 · 320" (rating · solved), "—" if none. */
function PlatformMini({
  row,
  platform,
}: {
  row: CodingLeaderboardRow;
  platform: CodingPlatform;
}) {
  const s = row.stats.find((x) => x.platform === platform);
  if (!s || s.handle === "") return <span className="text-ink-muted">—</span>;
  return (
    <span className="tabular-nums text-ink-secondary">
      {num(s.rating)} · {num(s.problemsSolved)}
    </span>
  );
}

function StatusBadge({ status }: { status: CodingFetchStatus }) {
  switch (status) {
    case CodingFetchStatus.OK:
      return <Badge variant="success">ok</Badge>;
    case CodingFetchStatus.NEVER:
      return <Badge variant="neutral">not fetched</Badge>;
    case CodingFetchStatus.NOT_FOUND:
      return <Badge variant="warning">handle?</Badge>;
    case CodingFetchStatus.ERROR:
      return <Badge variant="error">stale</Badge>;
    default:
      return null;
  }
}

export function CollegeCodingLeaderboardPage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();
  const entitled = checkEntitlement(context.entitlements, CollegeFeature.CODING_PROFILES);

  const [platform, setPlatform] = useState<CodingPlatform>(CodingPlatform.CODEFORCES);
  const [metric, setMetric] = useState<CodingMetric>(CodingMetric.RATING);
  const [unitId, setUnitId] = useState<string>("");
  const [groupId, setGroupId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);

  const params = useMemo(
    () => ({
      platform,
      metric,
      ...(unitId ? { unitId } : {}),
      ...(groupId ? { groupId } : {}),
    }),
    [platform, metric, unitId, groupId],
  );

  const q = useQuery(
    () => (entitled ? api.codingLeaderboard.get(slug, params) : Promise.resolve(null)),
    [slug, entitled, params],
  );
  // Dropdown sources — degrade gracefully (a missing feature/permission → none).
  const unitsQ = useQuery(
    () => api.collegeOrgUnits.listTree(slug).catch(() => ({ items: [] })),
    [slug],
  );
  const groupsQ = useQuery(
    () => api.attendance.listGroups(slug).catch(() => ({ items: [] })),
    [slug],
  );

  const unitOptions = useMemo(
    () => flattenUnits((unitsQ.data?.items ?? []) as TreeNode[]),
    [unitsQ.data],
  );
  const groupOptions = groupsQ.data?.items ?? [];

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader title="Coding leaderboard" description="Rank students by coding stats." />
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

  const download = async (): Promise<void> => {
    setDownloading(true);
    try {
      const { blob, filename } = await api.codingLeaderboard.report(slug, params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setDownloading(false);
    }
  };

  const data = q.data;
  const rows = data?.rows ?? [];
  const q2 = search.trim().toLowerCase();
  const filteredRows = q2
    ? rows.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q2) ||
          r.rollNumber.toLowerCase().includes(q2),
      )
    : rows;

  const metricHeader = `${PLATFORM_LABEL[platform]} ${METRIC_LABEL[metric]}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coding leaderboard"
        description="Ranked over stored stats — always fast, never a live fetch."
        actions={
          <Button
            variant="secondary"
            disabled={downloading || rows.length === 0}
            onClick={() => void download()}
          >
            <Download className="h-4 w-4" /> Download Excel
          </Button>
        }
      />

      {/* Filters */}
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="space-y-1 w-full sm:w-auto">
          <span className="text-xs font-medium text-ink-secondary">Platform</span>
          <Select value={platform} onValueChange={(v) => setPlatform(v as CodingPlatform)}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(CodingPlatform).map((p) => (
                <SelectItem key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 w-full sm:w-auto flex-shrink-0 overflow-x-auto pb-1">
          <span className="text-xs font-medium text-ink-secondary">Rank by</span>
          <div className="flex gap-1 w-max">
            {Object.values(CodingMetric).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={metric === m ? "primary" : "outline"}
                onClick={() => setMetric(m)}
              >
                {METRIC_LABEL[m]}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1 w-full sm:w-auto">
          <span className="text-xs font-medium text-ink-secondary">Org unit</span>
          <Select value={unitId || "all"} onValueChange={(v) => setUnitId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="All units" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All units</SelectItem>
              {unitOptions.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {groupOptions.length > 0 ? (
          <div className="space-y-1">
            <span className="text-xs font-medium text-ink-secondary">Attendance group</span>
            <Select
              value={groupId || "all"}
              onValueChange={(v) => setGroupId(v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groupOptions.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </Card>

      {q.loading ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : q.error ? (
        <Alert variant="error">{q.error}</Alert>
      ) : !data ? null : (
        <>
          {/* Overview */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Users} label="Students in view" value={data.overview.totalStudents} />
            <StatCard icon={Code2} label="Linked handles" value={data.overview.linked} />
            <StatCard icon={BarChart3} label={`Ranked (${metricHeader})`} value={data.overview.ranked} />
            <StatCard icon={BarChart3} label="Not ranked (na/stale)" value={data.overview.unranked} />
          </div>

          {data.overview.linked === 0 ? (
            <EmptyState
              title="No linked coding profiles yet"
              description="Once students add their Codeforces / LeetCode / CodeChef handles and stats are fetched, the leaderboard appears here."
              icon={<Code2 />}
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle p-4">
                <h3 className="text-sm font-semibold text-ink">
                  Ranked by {metricHeader}
                </h3>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or roll…"
                    className="w-56 pl-8"
                    aria-label="Search students"
                  />
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Roll</TableHead>
                    <TableHead>Org unit</TableHead>
                    <TableHead>{metricHeader}</TableHead>
                    <TableHead>CF (r·s)</TableHead>
                    <TableHead>LC (r·s)</TableHead>
                    <TableHead>CC (r·s)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((r) => (
                    <TableRow key={r.studentId}>
                      <TableCell>
                        {r.rank === null ? (
                          <span className="text-ink-muted">—</span>
                        ) : (
                          <Badge variant={r.rank <= 3 ? "success" : "neutral"}>#{r.rank}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-ink">{r.fullName}</TableCell>
                      <TableCell className="font-mono text-ink-secondary">{r.rollNumber}</TableCell>
                      <TableCell className="text-ink-secondary">{r.orgUnitName ?? "—"}</TableCell>
                      <TableCell className="tabular-nums font-semibold text-ink">
                        {num(r.metricValue)}
                      </TableCell>
                      <TableCell>
                        <PlatformMini row={r} platform={CodingPlatform.CODEFORCES} />
                      </TableCell>
                      <TableCell>
                        <PlatformMini row={r} platform={CodingPlatform.LEETCODE} />
                      </TableCell>
                      <TableCell>
                        <PlatformMini row={r} platform={CodingPlatform.CODECHEF} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.rankedStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
