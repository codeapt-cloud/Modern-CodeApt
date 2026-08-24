/**
 * Communication composite LIST (Step 21) — role-aware. An operator (COMMUNICATION
 * + `authoring`) sees the authoring list: create, edit, view the cohort, publish,
 * delete. A student sees the composites their cohort can take, each linking into
 * the one-entry-point runner view. The composite is a container over existing
 * exam/essay/speaking artifacts — this page never touches those engines.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { Layers, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeCommunicationAssessmentsPage() {
  const { slug, context } = useCollege();
  const navigate = useNavigate();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.COMMUNICATION,
  );
  const canAuthor = checkEntitlement(
    context.entitlements,
    CollegeFeature.COMMUNICATION,
    "authoring",
  );

  const authoring = useQuery(
    () =>
      canAuthor
        ? api.collegeCommunication.list(slug)
        : Promise.resolve({ items: [] }),
    [slug, canAuthor],
  );
  const available = useQuery(
    () =>
      entitled && !canAuthor
        ? api.collegeCommunication.available(slug)
        : Promise.resolve({ items: [] }),
    [slug, entitled, canAuthor],
  );

  const togglePublish = async (id: string, next: boolean): Promise<void> => {
    try {
      await api.collegeCommunication.setPublished(slug, id, next);
      authoring.refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not change publish state");
    }
  };
  const remove = async (id: string): Promise<void> => {
    if (!confirm("Delete this assessment? The underlying parts are untouched.")) return;
    try {
      await api.collegeCommunication.remove(slug, id);
      authoring.refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not delete");
    }
  };

  if (!entitled) {
    return <Alert variant="info">Your college hasn’t enabled Communication.</Alert>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            Communication assessments
          </h1>
          <p className="text-sm text-ink-muted">
            {canAuthor
              ? "Compose grammar, comprehension, speaking, and email into one ordered assessment."
              : "The full communication assessments assigned to your cohort."}
          </p>
        </div>
        {canAuthor && (
          <Button onClick={() => navigate(`/c/${slug}/communication/assessments/manage`)}>
            <Plus className="mr-1 h-4 w-4" /> New assessment
          </Button>
        )}
      </div>

      {canAuthor ? (
        authoring.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : authoring.data && authoring.data.items.length > 0 ? (
          <div className="space-y-3">
            {authoring.data.items.map((a) => (
              <Card key={a.id}>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <Layers className="h-5 w-5 text-ink-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{a.title}</span>
                      <Badge variant={a.isPublished ? "success" : "neutral"}>
                        {a.isPublished ? "Published" : "Draft"}
                      </Badge>
                    </div>
                    <p className="text-xs text-ink-muted">{a.partCount} parts</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/c/${slug}/communication/assessments/manage?id=${a.id}`,
                      )
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/c/${slug}/communication/assessments/${a.id}/cohort`,
                      )
                    }
                  >
                    Cohort
                  </Button>
                  <Button
                    size="sm"
                    variant={a.isPublished ? "ghost" : "primary"}
                    onClick={() => void togglePublish(a.id, !a.isPublished)}
                  >
                    {a.isPublished ? "Unpublish" : "Publish"}
                  </Button>
                  {!a.isPublished && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void remove(a.id)}
                    >
                      Delete
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No assessments yet"
            description="Compose your first communication assessment from existing papers."
          />
        )
      ) : available.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : available.data && available.data.items.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {available.data.items.map((a) => (
            <Link
              key={a.id}
              to={`/c/${slug}/communication/assessments/${a.id}`}
              className="block"
            >
              <Card className="h-full transition-colors hover:border-ink-muted">
                <CardContent className="p-5">
                  <div className="font-medium text-ink">{a.title}</div>
                  {a.description && (
                    <p className="mt-1 text-sm text-ink-muted">{a.description}</p>
                  )}
                  <p className="mt-2 text-xs text-ink-muted">{a.partCount} parts</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nothing assigned yet"
          description="Your cohort has no communication assessments right now."
        />
      )}
    </div>
  );
}

export default CollegeCommunicationAssessmentsPage;
