/**
 * College speaking AUTHORING page — the college surface for the shared
 * SpeakingAssessmentEditor. Lists the college's assessments and mounts the
 * editor for new/edit. The editor itself is surface-agnostic (injected adapter);
 * this page binds the college adapter + org-unit tree + role. A platform-admin
 * surface would be a sibling page with the platform adapter — none exists yet
 * (no platform speaking API; see the Step-13 report).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { SpeakingAssessmentEditor } from "../../components/speaking/admin/SpeakingAssessmentEditor.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { collegeSpeakingAuthoringApi } from "../../lib/speaking-authoring-api.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeSpeakingEditorPage() {
  const { slug, context } = useCollege();
  const authApi = useMemo(() => collegeSpeakingAuthoringApi(slug), [slug]);
  const tree = useQuery(() => api.collegeOrgUnits.listTree(slug), [slug]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const list = useQuery(() => authApi.list(), [authApi, reloadTick]);

  if (editing !== null) {
    return (
      <SpeakingAssessmentEditor
        authApi={authApi}
        surface="college"
        assessmentId={editing === "new" ? null : editing}
        orgUnitTree={tree.data?.items ?? []}
        role={context.membership.role}
        onSaved={() => setReloadTick((n) => n + 1)}
        onBack={() => {
          setEditing(null);
          setReloadTick((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Speaking — manage</h1>
          <p className="text-sm text-ink-muted">
            Compose speaking assessments from the item types, or start from a
            company preset.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/c/${slug}/speaking`}>Back to Speaking</Link>
          </Button>
          <Button size="sm" onClick={() => setEditing("new")}>
            New assessment
          </Button>
        </div>
      </div>

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
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(a.id)}>
                    Edit
                  </Button>
                  {/* Step 32 tier-2: re-verify the whole cohort on Whisper. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void api.collegeSpeaking
                        .rescoreCohort(slug, a.id)
                        .then((r) =>
                          alert(
                            `Re-scoring on Whisper: ${r.requeued} attempt(s), ${r.itemsQueued} clip(s) queued.`,
                          ),
                        )
                        .catch((e) =>
                          alert(e instanceof Error ? e.message : "Re-score failed"),
                        );
                    }}
                  >
                    Re-score cohort
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default CollegeSpeakingEditorPage;
