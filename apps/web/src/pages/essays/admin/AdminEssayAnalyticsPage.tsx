/**
 * Essay analytics review (route: /admin/essay-analytics). A paginated, filterable
 * (by topic + status) list of essay attempts; each row shows the student, topic,
 * score, status, and a compact real-signal preview (paste events / pasted chars)
 * where analytics were recorded. Opening a row shows the full stored signals and
 * the explicit "risk scoring not yet computed" state. Read-only.
 */
import { EssayStatus, type AdminEssayAnalyticsListItem } from "@codeapt/shared";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";

import { RiskBadge } from "../../../components/essay/EssayBadges.js";
import { EssayAnalyticsDetailDialog } from "../../../components/essays/admin/EssayAnalyticsDetailDialog.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Card } from "../../../components/ui/card.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { Pagination } from "../../../components/ui/pagination.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { api } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";

const PAGE_SIZE = 20;
const ANY = "__any__";

const STATUS_LABEL: Record<string, string> = {
  [EssayStatus.DRAFT]: "Draft",
  [EssayStatus.IN_PROGRESS]: "In progress",
  [EssayStatus.SUBMITTED]: "Submitted",
  [EssayStatus.UNDER_REVIEW]: "Under review",
  [EssayStatus.GRADED]: "Graded",
  [EssayStatus.CANCELLED]: "Cancelled",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export function AdminEssayAnalyticsPage() {
  const [topic, setTopic] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  const topics = useQuery(() => api.adminEssayTopics.list(), []);

  const { data, loading, error } = useQuery(
    () =>
      api.adminEssayAnalytics.list({
        page,
        pageSize: PAGE_SIZE,
        ...(topic !== ANY ? { essayTopic: topic } : {}),
        ...(status !== ANY ? { status: status as EssayStatus } : {}),
      }),
    [topic, status, page],
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Essay analytics"
        description="Review essay attempts and their captured anti-cheat compose signals."
      />

      <Alert variant="info" title="Risk scoring is advisory">
        Each attempt gets a risk score computed from its captured compose
        signals (paste ratio, typing vs. length, paste-block size). It is a
        review aid to flag attempts worth a closer look — it never penalizes a
        student, changes a grade, or blocks a submission.
      </Alert>

      <div className="flex flex-wrap gap-3">
        <Select
          value={topic}
          onValueChange={(v) => {
            setPage(1);
            setTopic(v);
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All prompts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All prompts</SelectItem>
            {(topics.data?.items ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            {Object.values(EssayStatus).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No essay attempts"
          description="No attempts match the current filters."
          icon={<ShieldAlert />}
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Signals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a: AdminEssayAnalyticsListItem) => (
                  <TableRow
                    key={a.attemptId}
                    className="cursor-pointer"
                    onClick={() => setSelected(a.attemptId)}
                  >
                    <TableCell className="font-medium text-ink">
                      {a.student}
                    </TableCell>
                    <TableCell className="text-ink-secondary">{a.topic}</TableCell>
                    <TableCell className="text-ink-secondary">
                      {a.finalScore}
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">
                        {STATUS_LABEL[a.status] ?? a.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {a.hasAnalytics ? (
                        <RiskBadge level={a.riskLevel} score={a.riskScore} />
                      ) : (
                        <span className="text-xs text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      {fmtDate(a.submittedAt)}
                    </TableCell>
                    <TableCell className="text-xs text-ink-secondary">
                      {a.hasAnalytics ? (
                        <>
                          {a.pasteEvents} paste{a.pasteEvents === 1 ? "" : "s"} ·{" "}
                          {a.pastedChars} chars
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-muted">
              {total} attempt{total === 1 ? "" : "s"}
            </p>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        </>
      )}

      {selected ? (
        <EssayAnalyticsDetailDialog
          attemptId={selected}
          onOpenChange={(o) => {
            if (!o) setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
