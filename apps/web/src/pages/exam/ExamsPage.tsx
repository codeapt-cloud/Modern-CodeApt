/**
 * Exams list — the exams a logged-in student can take, with attempt usage and
 * their last result. "Start"/"Resume" enters the fullscreen runner; disabled
 * (with a reason) once the attempt limit is reached.
 *
 * Tenant-aware (Phase 4b-ii-B): a COLLEGE student also sees their published,
 * cohort-targeted college exams here — the least-surprising place, since they
 * already land in the learner app. College exams (from GET /c/:slug/exams) are
 * merged in front of any individual/enrollment exams and reuse the SAME cards +
 * runner; only the list + start endpoints are tenant-scoped. Individual users
 * (no college) see exactly the previous flat list.
 */
import { FileCheck2 } from "lucide-react";

import { ExamStatusCard } from "../../components/exam/ExamStatusCard.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { mergeStudentExams } from "../../lib/student-exams.js";
import { useQuery } from "../../lib/use-query.js";

export function ExamsPage() {
  const individualQuery = useQuery(() => api.exams.list(), []);
  // The student's own college (null for individual users), then that college's
  // takeable exams. Tolerate the college call failing (e.g. the `exams` feature
  // is off) by degrading to no college exams — the page still shows individual
  // exams rather than erroring.
  const collegeQuery = useQuery(async () => {
    const { college } = await api.me.college();
    if (!college) return { slug: null, items: [] };
    try {
      const res = await api.collegeExams.studentList(college.slug);
      return { slug: college.slug, items: res.items };
    } catch {
      return { slug: college.slug, items: [] };
    }
  }, []);

  const loading = individualQuery.loading || collegeQuery.loading;
  const error = individualQuery.error;
  const items = mergeStudentExams(
    individualQuery.data?.items ?? [],
    collegeQuery.data?.items ?? [],
    collegeQuery.data?.slug ?? null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mock Exams"
        description="Timed, sectioned exams. Each section is separately timed and grading is automatic."
      />

      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No exams available"
          description="Exams appear here when you're enrolled in a subject that includes one, or when your college assigns one to your cohort."
          icon={<FileCheck2 />}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <ExamStatusCard
              key={`${item.source}:${item.id}`}
              item={item}
              collegeSlug={item.collegeSlug ?? undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
