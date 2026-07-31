/**
 * Campus Challenges (route: /c/:slug/challenges) — the college's view of its
 * students' standings on the shared DAILY challenge. Unlike exams/essays there is
 * nothing to author or assign here: the daily challenge is one global problem a
 * day that students solve in their learner app (Daily Challenge). This page is a
 * tenant-scoped LEADERBOARD (rank / student / roll / score / streak) reusing the
 * daily-challenge engine's UserStreak, gated by the `challenges` feature. Rich
 * analytics is Phase 5. Mirrors the other college pages' polish.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { Flame, Trophy } from "lucide-react";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeChallengesPage() {
  const { slug, context } = useCollege();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.CHALLENGES,
  );

  const boardQuery = useQuery(
    () =>
      entitled
        ? api.collegeChallenges.leaderboard(slug)
        : Promise.resolve({ rows: [], page: 1, pageSize: 0, total: 0 }),
    [slug, entitled],
  );
  const rows = boardQuery.data?.rows ?? [];

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Challenges"
          description="Your students' daily-challenge leaderboard."
        />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <Trophy className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">
            Challenges aren&apos;t enabled
          </h2>
          <p className="text-sm text-ink-muted">
            This feature isn&apos;t turned on for your college. Contact your
            CodeApt administrator to enable it.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campus Challenges"
        description="How your students rank on the daily coding challenge. They solve it in their learner app; this is your college's leaderboard."
      />

      {boardQuery.loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : boardQuery.error ? (
        <Alert variant="error">{boardQuery.error}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No standings yet"
          description="Once your students start solving the daily challenge, their scores and streaks appear here."
          icon={<Trophy />}
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Rank</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Roll</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Streak</TableHead>
                <TableHead>Best</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.userId}>
                  <TableCell>
                    <Badge variant={r.rank <= 3 ? "primary" : "neutral"}>
                      #{r.rank}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-ink">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs text-ink-secondary">
                    {r.rollNumber || "—"}
                  </TableCell>
                  <TableCell className="font-mono font-semibold text-ink">
                    {r.totalScore}
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    <span className="inline-flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5 text-warning-fg" />
                      {r.currentStreak}
                    </span>
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {r.maxStreak}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="text-xs text-ink-muted">
        Per-department and per-section breakdowns are coming in a later phase.
      </p>
    </div>
  );
}
