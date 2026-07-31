/**
 * My results (student space, route: /c/:slug/results). Aggregates this student's
 * OWN completed college work — graded exams (score + pass/fail) and graded
 * essays (final score) — DERIVED from the same tenant student lists the exams/
 * essays sections use (no new endpoint, no fabricated data; see
 * `buildStudentResults`). Essay rows link back into the EXISTING writer
 * (/essays/:id?c=<slug>) whose history view shows the full breakdown; exam scores
 * are shown inline (the runner has no standalone review route). Member-open, but
 * empty until the student has graded work.
 */
import { Award, ClipboardCheck, PenLine } from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Stagger, StaggerItem } from "../../components/motion/index.js";
import { Badge } from "../../components/ui/badge.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { buildStudentResults } from "../../lib/student-results.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeStudentResultsPage() {
  const { slug } = useCollege();

  // Tolerate a feature being off (or empty) — degrade to no rows, never error.
  const examsQuery = useQuery(
    () => api.collegeExams.studentList(slug).catch(() => ({ items: [] })),
    [slug],
  );
  const essaysQuery = useQuery(
    () => api.collegeEssays.studentList(slug).catch(() => ({ items: [] })),
    [slug],
  );

  const loading = examsQuery.loading || essaysQuery.loading;
  const rows = buildStudentResults(
    examsQuery.data?.items ?? [],
    essaysQuery.data?.items ?? [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="My results"
        description="Your scores across completed college exams and essays."
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No results yet"
          description="Complete an exam or essay from your college and your scores will show up here."
          icon={<Award />}
        />
      ) : (
        <Stagger className="space-y-3">
          {rows.map((row) => (
            <StaggerItem key={`${row.kind}:${row.id}`}>
              <Card className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    {row.kind === "exam" ? (
                      <ClipboardCheck className="h-5 w-5" />
                    ) : (
                      <PenLine className="h-5 w-5" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{row.title}</p>
                    <p className="text-xs text-ink-muted">
                      {row.kind === "exam" ? "Exam" : "Essay"}
                    </p>
                  </div>
                </div>

                {row.kind === "exam" ? (
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-ink">
                      {row.score}/{row.totalMarks}
                    </span>
                    <Badge variant={row.passed ? "success" : "error"}>
                      {row.passed ? "Pass" : "Fail"}
                    </Badge>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-ink">
                      {row.finalScore.toFixed(1)}/100
                    </span>
                    <Link
                      to={`/essays/${row.id}?c=${encodeURIComponent(slug)}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Review
                    </Link>
                  </div>
                )}
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
