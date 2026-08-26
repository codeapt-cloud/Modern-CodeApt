/**
 * Platform-admin communication composite authoring (S30) — the sibling of the
 * college communication manage page, mounting the SAME shared
 * CommunicationAssessmentEditor with the PLATFORM adapter (college:null parts +
 * COMMUNICATION-topic attach). A thin per-surface wrapper, like AdminSpeakingPage.
 */
import { useMemo, useState } from "react";

import { CommunicationAssessmentEditor } from "../../../components/communication/admin/CommunicationAssessmentEditor.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent } from "../../../components/ui/card.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { parseApiError } from "../../../lib/api-client.js";
import { platformCommunicationAuthoringApi } from "../../../lib/communication-authoring-api.js";
import { useQuery } from "../../../lib/use-query.js";

export function AdminCommunicationPage() {
  const authApi = useMemo(() => platformCommunicationAuthoringApi(), []);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const list = useQuery(() => authApi.list(), [authApi, reloadTick]);

  // Publish refusal names the offending/absent part; delete refuses a published
  // composite — surface the SERVER's reason rather than failing silently.
  const togglePublish = async (id: string, next: boolean): Promise<void> => {
    setActionError(null);
    try {
      await authApi.setPublished(id, next);
      setReloadTick((n) => n + 1);
    } catch (err) {
      setActionError(parseApiError(err).message);
    }
  };
  const remove = async (id: string): Promise<void> => {
    if (!confirm("Delete this composite? The underlying parts are untouched.")) return;
    setActionError(null);
    try {
      await authApi.remove(id);
      setReloadTick((n) => n + 1);
    } catch (err) {
      setActionError(parseApiError(err).message);
    }
  };

  if (editing !== null) {
    return (
      <CommunicationAssessmentEditor
        authApi={authApi}
        surface="platform"
        assessmentId={editing === "new" ? null : editing}
        onSaved={() => {
          setEditing(null);
          setReloadTick((n) => n + 1);
        }}
        onBack={() => {
          setEditing(null);
          setReloadTick((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Communication assessments"
          description="Compose platform composites from platform exam / essay / speaking artifacts, and attach them to COMMUNICATION curriculum topics."
        />
        <Button size="sm" onClick={() => setEditing("new")}>
          New composite
        </Button>
      </div>

      {actionError ? <Alert variant="error">{actionError}</Alert> : null}

      {list.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : list.error ? (
        <Alert variant="error">{list.error}</Alert>
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No composites yet"
          description="Create a composite that sequences platform exam / essay / speaking parts."
        />
      ) : (
        <div className="space-y-3">
          {list.data?.items.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{a.title}</span>
                    <Badge variant={a.isPublished ? "success" : "neutral"}>
                      {a.isPublished ? "Published" : "Draft"}
                    </Badge>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {a.partCount} part{a.partCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(a.id)}>
                    Edit
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
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default AdminCommunicationPage;
