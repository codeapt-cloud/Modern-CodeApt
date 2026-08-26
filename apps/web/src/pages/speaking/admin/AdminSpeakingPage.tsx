/**
 * Platform-admin speaking authoring (S30) — the sibling of the college speaking
 * manage page, mounting the SAME shared SpeakingAssessmentEditor with the
 * PLATFORM adapter (surface="platform": curriculum-topic attach, no org-units).
 * This is the mounting the `surface: "platform"` prop was built for (Step 13 left
 * it unmounted). A thin per-surface wrapper, exactly like AdminGameSetsPage.
 */
import { useMemo, useState } from "react";

import { SpeakingAssessmentEditor } from "../../../components/speaking/admin/SpeakingAssessmentEditor.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent } from "../../../components/ui/card.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { parseApiError } from "../../../lib/api-client.js";
import { platformSpeakingAuthoringApi } from "../../../lib/speaking-authoring-api.js";
import { useQuery } from "../../../lib/use-query.js";

export function AdminSpeakingPage() {
  const authApi = useMemo(() => platformSpeakingAuthoringApi(), []);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const list = useQuery(() => authApi.list(), [authApi, reloadTick]);

  // Publish refusal (NOT_PUBLISHABLE names the offending item / empty case) and
  // delete refusal (published, or has attempts) must surface the SERVER's reason.
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
    if (!confirm("Delete this assessment? Its attempts (if any) block deletion."))
      return;
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
      <SpeakingAssessmentEditor
        authApi={authApi}
        surface="platform"
        assessmentId={editing === "new" ? null : editing}
        onSaved={() => setReloadTick((n) => n + 1)}
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
          title="Speaking assessments"
          description="Author platform speaking assessments and attach them to SPEAKING curriculum topics."
        />
        <Button size="sm" onClick={() => setEditing("new")}>
          New assessment
        </Button>
      </div>

      {actionError ? <Alert variant="error">{actionError}</Alert> : null}

      {list.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : list.error ? (
        <Alert variant="error">{list.error}</Alert>
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No assessments yet"
          description="Create one from scratch or load a preset (CTS / Accenture / Versant / SVAR)."
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
                    {a.itemCount} item{a.itemCount === 1 ? "" : "s"}
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

export default AdminSpeakingPage;
