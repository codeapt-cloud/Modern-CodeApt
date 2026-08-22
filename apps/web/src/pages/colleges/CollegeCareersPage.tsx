/**
 * Campus Placements — the college's job/internship postings (route:
 * /c/:slug/postings). Lists the postings this college authored (title, company,
 * draft/published lifecycle, target-cohort chips, open/closed, application
 * count) with Create + per-row actions (applicants, edit, publish toggle,
 * delete). REUSES the platform-admin PostingEditorDialog pointed at the tenant
 * endpoints (injected authApi) with the college-specific org-unit targeting.
 * Tenant-scoped + faculty-scoped by the 5b backend; gated by the `postings`
 * feature. Mirrors CollegeEssaysPage.
 */
import {
  CollegeFeature,
  checkEntitlement,
  type AdminPosting,
  type CollegePostingSummary,
} from "@codeapt/shared";
import {
  Briefcase,
  Eye,
  EyeOff,
  Plus,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";

import { PostingEditorDialog } from "../../components/careers/PostingEditorDialog.js";
import { CollegeApplicationsDialog } from "../../components/colleges/careers/CollegeApplicationsDialog.js";
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
import { collegeCareersAuthoringApi } from "../../lib/careers-authoring-api.js";
import { postingTypeLabel } from "../../lib/careers-ui.js";
import { summarizeTargets } from "../../lib/exam-targeting.js";
import { flattenTree } from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

type Editing =
  | { mode: "create" }
  | { mode: "edit"; posting: AdminPosting; orgUnitIds: string[] };

export function CollegeCareersPage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.POSTINGS,
  );
  const role = context.membership.role;
  const authApi = collegeCareersAuthoringApi(slug);

  const postingsQuery = useQuery(
    () =>
      entitled
        ? api.collegeCareers.list(slug)
        : Promise.resolve({ items: [] }),
    [slug, entitled],
  );
  const treeQuery = useQuery(() => api.collegeOrgUnits.listTree(slug), [slug]);
  const tree = treeQuery.data?.items ?? [];
  const flat = flattenTree(tree);
  const postings = postingsQuery.data?.items ?? [];

  const [editing, setEditing] = useState<Editing | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [applicantsFor, setApplicantsFor] = useState<CollegePostingSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(
    null,
  );

  const openEdit = async (summary: CollegePostingSummary): Promise<void> => {
    try {
      const posting = await api.collegeCareers.get(slug, summary.id);
      setEditing({ mode: "edit", posting, orgUnitIds: summary.orgUnitIds });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    }
  };

  const togglePublish = async (p: CollegePostingSummary): Promise<void> => {
    setPublishingId(p.id);
    try {
      await api.collegeCareers.setPublished(slug, p.id, !p.isPublished);
      toast({
        variant: "success",
        title: p.isPublished ? "Posting unpublished" : "Posting published",
      });
      postingsQuery.refetch();
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
          title="Placements"
          description="Post jobs and internships to your cohorts and track applicants."
        />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <Briefcase className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">
            Placements aren&apos;t enabled
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
        title="Campus Placements"
        description="Post jobs & internships, target them at cohorts, publish for your students to apply, and review applicants."
        actions={
          <Button onClick={() => setEditing({ mode: "create" })}>
            <Plus className="h-4 w-4" /> New posting
          </Button>
        }
      />

      {postingsQuery.loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : postingsQuery.error ? (
        <Alert variant="error">{postingsQuery.error}</Alert>
      ) : postings.length === 0 ? (
        <EmptyState
          title="No postings yet"
          description="Create your first job or internship posting, target the cohorts it's for, then publish it."
          icon={<Briefcase />}
          action={
            <Button size="sm" onClick={() => setEditing({ mode: "create" })}>
              <Plus className="h-4 w-4" /> New posting
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {postings.map((p) => {
            const targets = summarizeTargets(p.orgUnitIds, flat);
            return (
              <Card key={p.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void openEdit(p)}
                    className="min-w-0 text-left"
                  >
                    <h3 className="truncate font-semibold text-ink hover:text-primary">
                      {p.title}
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {p.company} · {postingTypeLabel(p.type)}
                    </p>
                  </button>
                  {p.isPublished ? (
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
                  {!p.isOpen ? <Badge variant="error">Closed</Badge> : null}
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setApplicantsFor(p)}
                    className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-primary"
                  >
                    <Users className="h-3.5 w-3.5" />
                    {p.applicationCount} applicant
                    {p.applicationCount === 1 ? "" : "s"}
                  </button>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={publishingId === p.id}
                      onClick={() => void togglePublish(p)}
                    >
                      {p.isPublished ? (
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
                      aria-label="Edit posting"
                      variant="ghost"
                      size="sm"
                      icon={<Settings2 className="h-4 w-4" />}
                      onClick={() => void openEdit(p)}
                    />
                    <IconButton
                      aria-label="Delete posting"
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                      onClick={() => setDeleting({ id: p.id, title: p.title })}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing ? (
        <PostingEditorDialog
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          initial={editing.mode === "edit" ? editing.posting : null}
          authApi={authApi}
          signatureFetcher={() => api.uploads.collegeSignature(slug)}
          targeting={{
            tree,
            role,
            initialOrgUnitIds:
              editing.mode === "edit" ? editing.orgUnitIds : [],
          }}
          onSaved={() => {
            setEditing(null);
            postingsQuery.refetch();
          }}
        />
      ) : null}

      {applicantsFor ? (
        <CollegeApplicationsDialog
          slug={slug}
          postingId={applicantsFor.id}
          postingTitle={applicantsFor.title}
          open
          onOpenChange={(o) => {
            if (!o) setApplicantsFor(null);
            postingsQuery.refetch();
          }}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this posting?"
        noun="posting"
        description={
          <>
            This permanently deletes “{deleting?.title}”. Postings with recorded
            applications can&apos;t be deleted — unpublish to retire them.
          </>
        }
        blockedHint="Unpublish this posting instead — it has recorded applications."
        onConfirm={() => api.collegeCareers.remove(slug, deleting!.id)}
        onDeleted={() => {
          toast({ title: "Posting deleted" });
          postingsQuery.refetch();
        }}
      />
    </div>
  );
}
