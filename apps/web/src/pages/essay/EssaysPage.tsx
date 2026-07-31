/**
 * Essays list — the writing prompts a logged-in student can attempt, sourced
 * from GET /essays (essay-type topics in enrolled subjects). Each card shows
 * difficulty, word bounds, time limit, and the last-attempt summary (with a
 * source badge when graded), and links to the writing screen.
 *
 * Tenant-aware (Phase 4c-ii): a COLLEGE student also sees their published,
 * cohort-targeted college essays here — the least-surprising place, since they
 * already land in the learner app. College essays (from GET /c/:slug/essays) are
 * merged in front of any individual/enrollment essays and reuse the SAME cards +
 * writer; only the list + topic endpoints are tenant-scoped. Individual users
 * (no college) see exactly the previous flat list.
 */
import { FileText } from "lucide-react";

import { EssayStatusCard } from "../../components/essay/EssayStatusCard.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { mergeStudentEssays } from "../../lib/student-essays.js";
import { useQuery } from "../../lib/use-query.js";

export function EssaysPage() {
  const individualQuery = useQuery(() => api.essays.list(), []);
  // The student's own college (null for individual users), then that college's
  // published/in-target essays. Tolerate the college call failing (e.g. the
  // `essays` feature is off) by degrading to none — the page still shows the
  // individual essays rather than erroring.
  const collegeQuery = useQuery(async () => {
    const { college } = await api.me.college();
    if (!college) return { slug: null, items: [] };
    try {
      const res = await api.collegeEssays.studentList(college.slug);
      return { slug: college.slug, items: res.items };
    } catch {
      return { slug: college.slug, items: [] };
    }
  }, []);

  const loading = individualQuery.loading || collegeQuery.loading;
  const error = individualQuery.error;
  const items = mergeStudentEssays(
    individualQuery.data?.items ?? [],
    collegeQuery.data?.items ?? [],
    collegeQuery.data?.slug ?? null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Essays"
        description="AI-reviewed writing practice with an instant, dimension-by-dimension breakdown."
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
          title="No essays available"
          description="Essays appear here when you're enrolled in a subject that includes a writing prompt, or when your college assigns one to your cohort."
          icon={<FileText />}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <EssayStatusCard
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
