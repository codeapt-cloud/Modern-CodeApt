/**
 * College exam results (route: /c/:slug/exams/:examId/results). The tenant-scoped
 * per-student results table from the 4b-i GET /c/:slug/exams/:id/results (JSON,
 * not xlsx): student, roll, status, score, pass/fail, warnings + malpractice,
 * completed-at. Each identified attempt can be reset (audited) via the tenant
 * reset endpoint. Rich per-department/section analytics is Phase 5 (noted here).
 */
import type { CollegeExamResultRow } from "@codeapt/shared";
import { ArrowLeft, BarChart3, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

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
import { EmptyState } from "../../components/ui/empty-state.js";
import { FormField } from "../../components/ui/form-field.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import { Textarea } from "../../components/ui/textarea.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function CollegeExamResultsPage() {
  const { slug } = useCollege();
  const { examId = "" } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  const resultsQuery = useQuery(
    () => api.collegeExams.results(slug, examId),
    [slug, examId],
  );
  const data = resultsQuery.data;
  const rows = data?.items ?? [];

  const [resetting, setResetting] = useState<{
    userId: string;
    student: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const submitReset = async (): Promise<void> => {
    if (!resetting) return;
    setFormError("");
    setSubmitting(true);
    try {
      await api.collegeExams.resetAttempts(slug, examId, {
        userId: resetting.userId,
        reason: reason.trim(),
      });
      toast({ variant: "success", title: "Attempts reset (audited)" });
      setResetting(null);
      setReason("");
      resultsQuery.refetch();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to={`/c/${slug}/exams/${examId}`}
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back to exam
      </Link>

      {resultsQuery.loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : resultsQuery.error ? (
        <Alert variant="error">{resultsQuery.error}</Alert>
      ) : !data ? null : (
        <>
          <PageHeader
            title={`Results — ${data.examTitle}`}
            description={`${rows.length} attempt${rows.length === 1 ? "" : "s"} · ${data.totalMarks} total marks`}
            actions={
              <Button
                variant="secondary"
                onClick={() => navigate(`/c/${slug}/exams/${examId}/analysis`)}
              >
                <BarChart3 className="h-4 w-4" /> Analysis
              </Button>
            }
          />

          {rows.length === 0 ? (
            <EmptyState
              title="No attempts yet"
              description="Once your students take this exam, their results appear here."
              icon={<RotateCcw />}
            />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Roll</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Warnings</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row: CollegeExamResultRow) => (
                    <TableRow key={row.attemptId}>
                      <TableCell className="text-ink">{row.student}</TableCell>
                      <TableCell className="font-mono text-xs text-ink-secondary">
                        {row.rollNumber || "—"}
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {row.status}
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {row.score} / {data.totalMarks}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant={row.passed ? "success" : "neutral"}>
                            {row.passed ? "PASS" : "—"}
                          </Badge>
                          {row.isMalpractice ? (
                            <Badge variant="warning">malpractice</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {row.warnings}
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {fmtDate(row.completedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.userId ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setResetting({
                                userId: row.userId!,
                                student: row.student,
                              })
                            }
                          >
                            <RotateCcw className="h-4 w-4" /> Reset
                          </Button>
                        ) : (
                          <span className="text-xs text-ink-muted">
                            Anonymous
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          <p className="text-xs text-ink-muted">
            Open <span className="font-medium text-ink">Analysis</span> for the
            score distribution, pass rate, hardest questions, and an Excel export.
          </p>
        </>
      )}

      {/* Reset-attempts confirm (audited) */}
      <Dialog
        open={resetting !== null}
        onOpenChange={(o) => {
          if (!o) {
            setResetting(null);
            setReason("");
            setFormError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset attempts?</DialogTitle>
            <DialogDescription>
              This clears {resetting?.student}&apos;s attempt counter for this
              exam so they can retake it. The reset is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <FormField label="Reason" hint="Recorded in the audit log.">
            <Textarea
              rows={2}
              value={reason}
              placeholder="e.g. support request — proctoring glitch"
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={submitting}
              onClick={() => void submitReset()}
            >
              <RotateCcw className="h-4 w-4" /> Reset attempts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
