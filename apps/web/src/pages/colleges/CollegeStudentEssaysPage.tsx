/**
 * My essays (student space, route: /c/:slug/essays for a student). Lists this
 * student's published, in-target college essay prompts (GET /c/:slug/essays
 * student list) and reuses the SAME EssayStatusCard → opens the EXISTING writer
 * at /essays/:id?c=<slug> (the writer + grading are untouched; the `?c` seam
 * only scopes list/detail/draft/submit and returns back-nav to this space).
 * Entitlement-gated on `essays`.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { FileText } from "lucide-react";

import { EssayStatusCard } from "../../components/essay/EssayStatusCard.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeStudentEssaysPage() {
  const { slug, context } = useCollege();
  const enabled = checkEntitlement(context.entitlements, CollegeFeature.ESSAYS);

  const query = useQuery(
    () => (enabled ? api.collegeEssays.studentList(slug) : Promise.resolve({ items: [] })),
    [slug, enabled],
  );
  const items = query.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My essays"
        description="Writing prompts assigned to your cohort, with an instant, dimension-by-dimension breakdown when graded."
      />

      {!enabled ? (
        <Alert variant="info">Essays aren&apos;t enabled for your college yet.</Alert>
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
          title="No essays available"
          description="Essays appear here when your college assigns a writing prompt to your cohort."
          icon={<FileText />}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <EssayStatusCard key={item.id} item={item} collegeSlug={slug} />
          ))}
        </div>
      )}
    </div>
  );
}
