/**
 * Exam result analysis (route: /c/:slug/exams/:examId/analysis) — Phase 5. The
 * "super clear at a glance" per-exam view: overview stat cards, the KEY
 * score-distribution HISTOGRAM, a pass/fail split, exam-section comparison bars,
 * the most-missed questions (when per-question data exists), a student org-unit
 * rollup, and a ranked student table — plus a one-click Excel export. Reuses the
 * dashboard StatCard + CSS bars; honest empty/no-data states.
 */
import type {
  ExamQuestionStat,
  ExamScoreBand,
  ExamStudentResult,
} from "@codeapt/shared";
import {
  ArrowLeft,
  Award,
  BarChart3,
  Download,
  Percent,
  Search,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { StatCard } from "../../components/colleges/StatCard.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Input } from "../../components/ui/input.js";
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
import { barPercent } from "../../lib/analytics-view.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const showRate = (r: number | null): string => (r === null ? "—" : `${r}%`);

/** The key visual: a vertical score-distribution histogram (0–100% deciles). */
function Histogram({ bands }: { bands: ExamScoreBand[] }) {
  const max = Math.max(1, ...bands.map((b) => b.count));
  return (
    <div className="flex h-48 items-end gap-1.5">
      {bands.map((b) => (
        <div
          key={b.label}
          className="flex flex-1 flex-col items-center justify-end gap-1"
          title={`${b.label}% · ${b.count} student${b.count === 1 ? "" : "s"}`}
        >
          <span className="text-[10px] tabular-nums text-ink-muted">
            {b.count || ""}
          </span>
          <div
            className="w-full rounded-t bg-primary/80 transition-[height] duration-700 ease-out"
            style={{ height: `${b.count === 0 ? 0 : Math.max(4, (b.count / max) * 100)}%` }}
          />
          <span className="text-[9px] text-ink-muted">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function PassFailBar({ passed, failed }: { passed: number; failed: number }) {
  const total = Math.max(1, passed + failed);
  const passPct = Math.round((passed / total) * 100);
  return (
    <div className="space-y-2">
      <div className="flex h-4 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full bg-success" style={{ width: `${passPct}%` }} />
        <div className="h-full bg-warning" style={{ width: `${100 - passPct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-ink-secondary">
        <span>{passed} passed</span>
        <span>{failed} failed</span>
      </div>
    </div>
  );
}

function RateBar({ label, rate }: { label: string; rate: number | null }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-ink-secondary">{label}</span>
        <span className="tabular-nums font-medium text-ink">{showRate(rate)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${barPercent(rate ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function CollegeExamAnalysisPage() {
  const { slug } = useCollege();
  const { examId = "" } = useParams();
  const { toast } = useToast();
  const q = useQuery(() => api.collegeExams.analysis(slug, examId), [slug, examId]);
  const [studentSearch, setStudentSearch] = useState("");
  const [downloading, setDownloading] = useState(false);

  const download = async (): Promise<void> => {
    setDownloading(true);
    try {
      const { blob, filename } = await api.collegeExams.analysisReport(slug, examId);
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
  const students: ExamStudentResult[] = data?.students ?? [];
  const filteredStudents = students.filter((s) => {
    const t = `${s.name} ${s.rollNumber}`.toLowerCase();
    return t.includes(studentSearch.trim().toLowerCase());
  });
  const hardest: ExamQuestionStat[] = (data?.questions ?? []).slice(0, 10);

  return (
    <div className="space-y-6">
      <Link
        to={`/c/${slug}/exams/${examId}/results`}
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back to results
      </Link>

      {q.loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : q.error ? (
        <Alert variant="error">{q.error}</Alert>
      ) : !data ? null : (
        <>
          <PageHeader
            title={`Analysis — ${data.examTitle}`}
            description={`${data.overview.completed} graded of ${data.overview.attempts} attempt${data.overview.attempts === 1 ? "" : "s"} · ${data.totalMarks} marks · pass ${data.passPercentage}%`}
            actions={
              <Button disabled={downloading || data.overview.completed === 0} onClick={() => void download()}>
                <Download className="h-4 w-4" /> Download Excel
              </Button>
            }
          />

          {data.overview.completed === 0 ? (
            <EmptyState
              title="No graded attempts yet"
              description="Once students complete and their attempts are graded, the distribution, pass rate, and rankings appear here."
              icon={<BarChart3 />}
            />
          ) : (
            <>
              {/* Overview */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  icon={Percent}
                  label="Average"
                  value={data.overview.avgPercent ?? 0}
                  suffix="%"
                  decimals={1}
                  hint={`avg ${data.overview.avgScore ?? 0} / ${data.totalMarks}`}
                />
                <StatCard
                  icon={Award}
                  label="Pass rate"
                  value={data.overview.passRate ?? 0}
                  suffix="%"
                  decimals={1}
                  hint={`${data.passFail.passed}/${data.overview.completed} passed`}
                />
                <StatCard
                  icon={BarChart3}
                  label="Highest"
                  value={data.overview.highest ?? 0}
                  hint={`lowest ${data.overview.lowest ?? 0} · median ${data.overview.median ?? 0}`}
                />
                <StatCard
                  icon={Users}
                  label="Graded"
                  value={data.overview.completed}
                  hint={`${data.overview.attempts} attempts`}
                />
              </div>

              {/* Key visual: distribution histogram + pass/fail */}
              <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <Card className="space-y-3 p-5">
                  <h3 className="text-sm font-semibold text-ink">
                    Score distribution
                  </h3>
                  <Histogram bands={data.distribution} />
                  <p className="text-center text-[11px] text-ink-muted">
                    % score band
                  </p>
                </Card>
                <Card className="space-y-4 p-5">
                  <h3 className="text-sm font-semibold text-ink">Pass / fail</h3>
                  <PassFailBar
                    passed={data.passFail.passed}
                    failed={data.passFail.failed}
                  />
                  {data.sections.length > 0 ? (
                    <div className="space-y-2 border-t border-subtle pt-3">
                      <p className="text-xs font-medium text-ink-muted">
                        By exam section (avg)
                      </p>
                      {data.sections.map((s) => (
                        <RateBar key={s.sectionId} label={s.name} rate={s.avgPercent} />
                      ))}
                    </div>
                  ) : null}
                </Card>
              </div>

              {/* Most-missed questions */}
              <Card className="space-y-3 p-5">
                <h3 className="text-sm font-semibold text-ink">
                  Hardest questions{" "}
                  <span className="text-xs font-normal text-ink-muted">
                    (lowest correct-rate)
                  </span>
                </h3>
                {!data.hasQuestionData ? (
                  <p className="text-sm text-ink-muted">
                    Per-question analysis isn&apos;t available for this exam&apos;s
                    attempts.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {hardest.map((qs) => (
                      <div key={qs.questionId} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="truncate text-ink-secondary">
                            <span className="text-ink-muted">[{qs.section}]</span>{" "}
                            {qs.text}
                          </span>
                          <span className="shrink-0 tabular-nums font-medium text-ink">
                            {showRate(qs.correctRate)}{" "}
                            <span className="text-ink-muted">
                              ({qs.correct}/{qs.total})
                            </span>
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                          <div
                            className={
                              "h-full rounded-full " +
                              ((qs.correctRate ?? 0) < 50 ? "bg-warning" : "bg-primary")
                            }
                            style={{ width: `${barPercent(qs.correctRate ?? 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* By org-unit (student dept/section) */}
              {data.units.some((u) => u.students > 0) ? (
                <Card className="overflow-hidden">
                  <div className="border-b border-subtle p-4">
                    <h3 className="text-sm font-semibold text-ink">By section</h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unit</TableHead>
                        <TableHead>Students</TableHead>
                        <TableHead>Avg %</TableHead>
                        <TableHead>Pass rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.units
                        .filter((u) => u.students > 0)
                        .map((u) => (
                          <TableRow key={u.id}>
                            <TableCell className="text-ink">
                              {u.name}{" "}
                              <Badge variant="neutral">{u.type}</Badge>
                            </TableCell>
                            <TableCell className="text-ink-secondary">
                              {u.students}
                            </TableCell>
                            <TableCell className="tabular-nums text-ink-secondary">
                              {showRate(u.avgPercent)}
                            </TableCell>
                            <TableCell className="tabular-nums text-ink-secondary">
                              {showRate(u.passRate)}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </Card>
              ) : null}

              {/* Ranked students */}
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-subtle p-4">
                  <h3 className="text-sm font-semibold text-ink">Rankings</h3>
                  <div className="relative w-56">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                    <Input
                      className="pl-9"
                      placeholder="Search…"
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                    />
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Roll</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>%</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStudents.map((s, i) => (
                      <TableRow key={s.attemptId}>
                        <TableCell className="tabular-nums text-ink-muted">
                          {i + 1}
                        </TableCell>
                        <TableCell className="text-ink">{s.name}</TableCell>
                        <TableCell className="font-mono text-xs text-ink-muted">
                          {s.rollNumber || "—"}
                        </TableCell>
                        <TableCell className="tabular-nums text-ink-secondary">
                          {s.score} / {data.totalMarks}
                        </TableCell>
                        <TableCell className="tabular-nums text-ink-secondary">
                          {showRate(s.percent)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={s.passed ? "success" : "neutral"}>
                            {s.passed ? "PASS" : "—"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
