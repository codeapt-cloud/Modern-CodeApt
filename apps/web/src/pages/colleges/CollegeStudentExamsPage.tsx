/**
 * My exams (student space, route: /c/:slug/exams for a student). Lists this
 * student's published, cohort-targeted college exams (GET /c/:slug/exams student
 * list) and reuses the SAME ExamStatusCard → starts the EXISTING fullscreen
 * runner at /exam/:id?c=<slug> (the shared /attempts/* engine is untouched; the
 * `?c` seam only scopes the LIST + START and returns back-nav to this space).
 * Entitlement-gated on `exams`.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { FileCheck2 } from "lucide-react";

import { ExamStatusCard } from "../../components/exam/ExamStatusCard.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeStudentExamsPage() {
  const { slug, context } = useCollege();
  const enabled = checkEntitlement(context.entitlements, CollegeFeature.EXAMS);

  const query = useQuery(
    () => (enabled ? api.collegeExams.studentList(slug) : Promise.resolve({ items: [] })),
    [slug, enabled],
  );
  const items = query.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My exams"
        description="Exams your college has assigned to your cohort. Each section is separately timed and grading is automatic."
      />

      {!enabled ? (
        <Alert variant="info">Exams aren&apos;t enabled for your college yet.</Alert>
      ) : query.loading ? (
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
      ) : query.error ? (
        <Alert variant="error">{query.error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No exams available"
          description="Exams appear here when your college assigns one to your cohort."
          icon={<FileCheck2 />}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <ExamStatusCard key={item.id} item={item} collegeSlug={slug} />
          ))}
        </div>
      )}
    </div>
  );
}
