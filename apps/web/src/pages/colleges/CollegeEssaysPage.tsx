/**
 * Campus Essays — the college's essay-topic list (route: /c/:slug/essays). Lists
 * the essay prompts this college authored (title, draft/published lifecycle,
 * difficulty, target-cohort chips, attempt count) with Create + per-row actions
 * (edit, publish toggle, results, delete). REUSES the platform-admin
 * EssayTopicEditorDialog pointed at the tenant endpoints (injected authApi) with
 * the college-specific org-unit targeting. Tenant-scoped + faculty-scoped by the
 * 4c-i backend; gated by the `essays` feature. Mirrors CollegeExamsPage.
 */
import {
  CollegeFeature,
  checkEntitlement,
  type AdminEssayTopic,
  type CollegeEssaySummary,
} from "@codeapt/shared";
import {
  BarChart3,
  Eye,
  EyeOff,
  FileText,
  PenLine,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { EssayTopicEditorDialog } from "../../components/essays/admin/EssayTopicEditorDialog.js";
import { ConfirmDeleteDialog } from "../../components/curriculum/admin/ConfirmDeleteDialog.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { collegeEssayAuthoringApi } from "../../lib/essay-authoring-api.js";
import { summarizeTargets } from "../../lib/exam-targeting.js";
import { flattenTree } from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

type Editing =
  | { mode: "create" }
  | { mode: "edit"; topic: AdminEssayTopic; orgUnitIds: string[] };

export function CollegeEssaysPage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();
  const navigate = useNavigate();
  const entitled = checkEntitlement(context.entitlements, CollegeFeature.ESSAYS);
  const role = context.membership.role;
  const authApi = collegeEssayAuthoringApi(slug);

  const topicsQuery = useQuery(
    () =>
      entitled ? api.collegeEssayTopics.list(slug) : Promise.resolve({ items: [] }),
    [slug, entitled],
  );
  const treeQuery = useQuery(() => api.collegeOrgUnits.listTree(slug), [slug]);
  const tree = treeQuery.data?.items ?? [];
  const flat = flattenTree(tree);
  const topics = topicsQuery.data?.items ?? [];

  const [editing, setEditing] = useState<Editing | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(
    null,
  );

  const openEdit = async (summary: CollegeEssaySummary): Promise<void> => {
    try {
      const topic = await api.collegeEssayTopics.get(slug, summary.id);
      setEditing({ mode: "edit", topic, orgUnitIds: summary.orgUnitIds });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    }
  };

  const togglePublish = async (t: CollegeEssaySummary): Promise<void> => {
    setPublishingId(t.id);
    try {
      await api.collegeEssayTopics.setPublished(slug, t.id, !t.isPublished);
      toast({
        variant: "success",
        title: t.isPublished ? "Essay unpublished" : "Essay published",
      });
      topicsQuery.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setPublishingId(null);
    }
  };

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Essays"
          description="Author and assign writing prompts to your cohorts."
        />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <PenLine className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">
            Essays aren&apos;t enabled
          </h2>
          <p className="text-sm text-ink-muted">
            This feature isn&apos;t turned on for your college. Contact your
            CodeApt administrator to enable it.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campus Essays"
        description="Author writing prompts — with AI-assisted relevance keywords — target them at cohorts, then publish for your students to write and get graded."
        actions={
          <Button onClick={() => setEditing({ mode: "create" })}>
            <Plus className="h-4 w-4" /> New essay
          </Button>
        }
      />

      {topicsQuery.loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : topicsQuery.error ? (
        <Alert variant="error">{topicsQuery.error}</Alert>
      ) : topics.length === 0 ? (
        <EmptyState
          title="No essays yet"
          description="Create your first essay prompt, target the cohorts it's for, then publish it."
          icon={<FileText />}
          action={
            <Button size="sm" onClick={() => setEditing({ mode: "create" })}>
              <Plus className="h-4 w-4" /> New essay
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {topics.map((t) => {
            const targets = summarizeTargets(t.orgUnitIds, flat);
            return (
              <Card key={t.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void openEdit(t)}
                    className="min-w-0 text-left"
                  >
                    <h3 className="truncate font-semibold text-ink hover:text-primary">
                      {t.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {t.minWords || t.maxWords
                        ? `${t.minWords || 0}–${t.maxWords || "∞"} words · `
                        : ""}
                      {t.timeLimitMinutes > 0
                        ? `${t.timeLimitMinutes} min · `
                        : ""}
                      max {t.maxAttempts} attempt{t.maxAttempts === 1 ? "" : "s"}
                    </p>
                  </button>
                  {t.isPublished ? (
                    <Badge variant="success">Published</Badge>
                  ) : (
                    <Badge variant="neutral">Draft</Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {targets.collegeWide ? (
                    <Badge variant="info">College-wide</Badge>
                  ) : (
                    targets.labels.map((label, i) => (
                      <Badge key={i} variant="neutral">
                        {label}
                      </Badge>
                    ))
                  )}
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-ink-muted">
                    {t.attemptCount} submission
                    {t.attemptCount === 1 ? "" : "s"}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        navigate(`/c/${slug}/essays/${t.id}/results`)
                      }
                    >
                      <BarChart3 className="h-4 w-4" /> Results
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={publishingId === t.id}
                      onClick={() => void togglePublish(t)}
                    >
                      {t.isPublished ? (
                        <>
                          <EyeOff className="h-4 w-4" /> Unpublish
                        </>
                      ) : (
                        <>
                          <Eye className="h-4 w-4" /> Publish
                        </>
                      )}
                    </Button>
                    <IconButton
                      aria-label="Edit essay"
                      variant="ghost"
                      size="sm"
                      icon={<Settings2 className="h-4 w-4" />}
                      onClick={() => void openEdit(t)}
                    />
                    <IconButton
                      aria-label="Delete essay"
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                      onClick={() => setDeleting({ id: t.id, title: t.title })}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing ? (
        <EssayTopicEditorDialog
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          initial={editing.mode === "edit" ? editing.topic : null}
          authApi={authApi}
          targeting={{
            tree,
            role,
            initialOrgUnitIds:
              editing.mode === "edit" ? editing.orgUnitIds : [],
          }}
          onSaved={() => {
            setEditing(null);
            topicsQuery.refetch();
          }}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this essay?"
        noun="essay"
        description={
          <>
            This permanently deletes “{deleting?.title}”. Essays with recorded
            student submissions can&apos;t be deleted — unpublish to retire them.
          </>
        }
        blockedHint="Unpublish this essay instead — it has recorded submissions."
        onConfirm={() => api.collegeEssayTopics.remove(slug, deleting!.id)}
        onDeleted={() => {
          toast({ title: "Essay deleted" });
          topicsQuery.refetch();
        }}
      />
    </div>
  );
}
