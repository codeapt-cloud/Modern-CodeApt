/**
 * College essay results (route: /c/:slug/essays/:essayTopicId/results). The
 * tenant-scoped per-student results from the 4c-i GET
 * /c/:slug/essay-topics/:id/results: student, roll, attempt #, grading status,
 * score, and source. Rich per-department/section analytics is Phase 5 (noted).
 */
import type { CollegeEssayResultRow } from "@codeapt/shared";
import { ArrowLeft, FileText, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EssayAiFeedbackPanel } from "../../components/essay/EssayAiFeedbackPanel.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function CollegeEssayResultsPage() {
  const { slug } = useCollege();
  const { essayTopicId = "" } = useParams();

  const resultsQuery = useQuery(
    () => api.collegeEssayTopics.results(slug, essayTopicId),
    [slug, essayTopicId],
  );
  const data = resultsQuery.data;
  const rows = data?.items ?? [];
  const [aiFor, setAiFor] = useState<CollegeEssayResultRow | null>(null);

  return (
    <div className="space-y-6">
      <Link
        to={`/c/${slug}/essays`}
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> All essays
      </Link>

      {resultsQuery.loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : resultsQuery.error ? (
        <Alert variant="error">{resultsQuery.error}</Alert>
      ) : !data ? null : (
        <>
          <PageHeader
            title={`Results — ${data.essayTitle}`}
            description={`${rows.length} submission${rows.length === 1 ? "" : "s"}`}
          />

          {rows.length === 0 ? (
            <EmptyState
              title="No submissions yet"
              description="Once your students write this essay, their graded results appear here."
              icon={<FileText />}
            />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Roll</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>AI</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row: CollegeEssayResultRow) => (
                    <TableRow key={row.attemptId}>
                      <TableCell className="text-ink">{row.student}</TableCell>
                      <TableCell className="font-mono text-xs text-ink-secondary">
                        {row.rollNumber || "—"}
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        #{row.attemptNumber}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === "completed"
                              ? "success"
                              : row.status === "failed"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-ink-secondary">
                        {row.finalScore !== null
                          ? `${row.finalScore.toFixed(1)}/100`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {row.source ?? "—"}
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {fmtDate(row.submittedAt)}
                      </TableCell>
                      <TableCell>
                        {row.status === "completed" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAiFor(row)}
                          >
                            <Sparkles className="h-4 w-4" /> Feedback
                          </Button>
                        ) : (
                          <span className="text-xs text-ink-muted">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          <p className="text-xs text-ink-muted">
            Per-department and per-section analytics are coming in a later phase.
          </p>
        </>
      )}

      <Dialog open={aiFor !== null} onOpenChange={(o) => !o && setAiFor(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" /> AI Feedback
              </span>
            </DialogTitle>
            <DialogDescription>
              {aiFor
                ? `${aiFor.student} · attempt #${aiFor.attemptNumber}. Written guidance to improve the essay — the grade is the score.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {aiFor ? (
            <EssayAiFeedbackPanel
              key={aiFor.attemptId}
              load={() => api.collegeEssayTopics.aiFeedback(slug, aiFor.attemptId)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
