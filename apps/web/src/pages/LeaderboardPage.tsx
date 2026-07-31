/**
 * Leaderboard — ranked by (total score desc, current streak desc), paginated.
 * The current user's row is highlighted, and their rank is shown separately
 * even when it falls outside the visible page.
 *
 * Rows stagger in on mount and animate to new positions when the data reorders
 * (framer-motion `layout`), composing the Step-1 stagger variants directly onto
 * the Table primitives. Under reduced motion the plain (static) Table renders —
 * no entrance, no layout animation.
 */
import type { LeaderboardRow } from "@codeapt/shared";
import { motion, useReducedMotion } from "framer-motion";
import { Flame, Trophy } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../components/layout/PageHeader.js";
import { Alert } from "../components/ui/alert.js";
import { Avatar } from "../components/ui/avatar.js";
import { Badge } from "../components/ui/badge.js";
import { Card } from "../components/ui/card.js";
import { EmptyState } from "../components/ui/empty-state.js";
import { Pagination } from "../components/ui/pagination.js";
import { Skeleton } from "../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { api } from "../lib/api-client.js";
import { cn } from "../lib/cn.js";
import { imageUrl } from "../lib/cloudinary.js";
import { staggerContainer, staggerItem } from "../lib/motion.js";
import { useQuery } from "../lib/use-query.js";

const MotionTableBody = motion.create(TableBody);
const MotionTableRow = motion.create(TableRow);

function rowClass(row: LeaderboardRow): string {
  const top3 = row.rank <= 3;
  return cn(
    row.isCurrentUser
      ? "bg-primary/10 hover:bg-primary/15"
      : top3 && "bg-primary/5", // subtle, tasteful top-3 tint
  );
}

function RowCells({ row }: { row: LeaderboardRow }) {
  return (
    <>
      <TableCell className="w-16 font-mono text-ink-muted">
        {row.rank <= 3 ? (
          <span className="text-lg">
            {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : "🥉"}
          </span>
        ) : (
          `#${row.rank}`
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar size="sm" name={row.name} src={imageUrl(row.avatarUrl) || undefined} />
          <span className="font-medium text-ink">{row.name}</span>
          {row.isCurrentUser ? <Badge variant="primary">You</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono">
        <span className="inline-flex items-center gap-1 text-ink">
          <Flame className="h-3.5 w-3.5 text-primary" />
          {row.currentStreak}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono font-semibold text-ink">
        {row.totalScore}
      </TableCell>
    </>
  );
}

function Row({ row, motionOn }: { row: LeaderboardRow; motionOn: boolean }) {
  if (!motionOn) {
    return (
      <TableRow className={rowClass(row)}>
        <RowCells row={row} />
      </TableRow>
    );
  }
  return (
    <MotionTableRow layout variants={staggerItem} className={rowClass(row)}>
      <RowCells row={row} />
    </MotionTableRow>
  );
}

export function LeaderboardPage() {
  const [page, setPage] = useState(1);
  const reduced = useReducedMotion();
  const motionOn = !reduced;
  const { data, loading, error } = useQuery(
    () => api.challenges.leaderboard({ page }),
    [page],
  );

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  const meOffPage =
    data?.me && !data.rows.some((r) => r.isCurrentUser) ? data.me : null;

  const rows = data ? (
    <>
      {data.rows.map((row) => (
        <Row key={row.userId} row={row} motionOn={motionOn} />
      ))}
      {meOffPage ? (
        <>
          <TableRow>
            <TableCell
              colSpan={4}
              className="py-1 text-center text-xs text-ink-muted"
            >
              ···
            </TableCell>
          </TableRow>
          <Row key={meOffPage.userId} row={meOffPage} motionOn={motionOn} />
        </>
      ) : null}
    </>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leaderboard"
        description="Top solvers by score, then streak. Keep solving to climb."
      />

      {loading ? (
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </Card>
      ) : error || !data ? (
        <Alert variant="error">
          {error ?? "Could not load the leaderboard."}
        </Alert>
      ) : data.total === 0 ? (
        <EmptyState
          title="No scores yet"
          description="Be the first to solve a daily challenge and top the board."
          icon={<Trophy />}
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right">Streak</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              {motionOn ? (
                <MotionTableBody
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                >
                  {rows}
                </MotionTableBody>
              ) : (
                <TableBody>{rows}</TableBody>
              )}
            </Table>
          </Card>

          <div className="flex justify-center">
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}
