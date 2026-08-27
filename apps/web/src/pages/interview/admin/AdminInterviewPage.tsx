/**
 * Platform-admin mock-interview authoring (Step 34) — the sibling of the college
 * manage page, mounting the SAME InterviewEditor with the PLATFORM adapter
 * (surface="platform": curriculum-topic attach, no org units). Mirrors AdminSpeakingPage.
 */
import { useMemo, useState } from "react";

import { InterviewEditor } from "../../../components/interview/admin/InterviewEditor.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card, CardContent } from "../../../components/ui/card.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { parseApiError } from "../../../lib/api-client.js";
import { platformInterviewAuthoringApi } from "../../../lib/interview-authoring-api.js";
import { useQuery } from "../../../lib/use-query.js";

export function AdminInterviewPage(): JSX.Element {
  const authApi = useMemo(() => platformInterviewAuthoringApi(), []);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [tick, setTick] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const list = useQuery(() => authApi.list(), [authApi, tick]);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setActionError(null);
    try {
      await fn();
      setTick((n) => n + 1);
    } catch (e) {
      setActionError(parseApiError(e).message);
    }
  };

  if (editing !== null) {
    return (
      <InterviewEditor
        authApi={authApi}
        surface="platform"
        assessmentId={editing === "new" ? null : editing}
        onSaved={() => setTick((n) => n + 1)}
        onBack={() => {
          setEditing(null);
          setTick((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Mock interviews"
          description="Author platform mock interviews and attach them to MOCK_INTERVIEW curriculum topics."
        />
        <Button size="sm" onClick={() => setEditing("new")}>
          New interview
        </Button>
      </div>

      {actionError ? <Alert variant="error">{actionError}</Alert> : null}

      {list.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No interviews yet" description="Create one to get started." />
      ) : (
        <div className="space-y-3">
          {list.data?.items.map((iv) => (
            <Card key={iv.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{iv.title}</span>
                    <Badge variant={iv.isPublished ? "success" : "neutral"}>
                      {iv.isPublished ? "Published" : "Draft"}
                    </Badge>
                  </div>
                  <p className="text-sm text-ink-muted">{iv.role}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(iv.id)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant={iv.isPublished ? "ghost" : "primary"}
                    onClick={() => void act(() => authApi.setPublished(iv.id, !iv.isPublished))}
                  >
                    {iv.isPublished ? "Unpublish" : "Publish"}
                  </Button>
                  {!iv.isPublished ? (
                    <Button variant="destructive" size="sm" onClick={() => void act(() => authApi.remove(iv.id))}>
                      Delete
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default AdminInterviewPage;
