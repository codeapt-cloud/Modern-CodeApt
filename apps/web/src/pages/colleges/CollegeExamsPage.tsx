/**
 * Campus Assessments — the college's exam list (route: /c/:slug/exams). Lists the
 * exams this college authored (title, draft/published lifecycle, section/question
 * counts, target-cohort chips, attempt count) with Create + per-row actions
 * (manage, publish toggle, results, delete). All calls are tenant-scoped +
 * faculty-scoped by the 4b-i backend; gated by the `exams` feature (a clear
 * "not enabled" state otherwise). Mirrors the other college pages' polish.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import {
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { CollegeExamSettingsDialog } from "../../components/colleges/exams/CollegeExamSettingsDialog.js";
import { ConfirmDeleteDialog } from "../../components/curriculum/admin/ConfirmDeleteDialog.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { FormField } from "../../components/ui/form-field.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { Input } from "../../components/ui/input.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { flattenTree } from "../../lib/org-structure-ui.js";
import { summarizeTargets } from "../../lib/exam-targeting.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";
import type { CollegeExamSummary } from "@codeapt/shared";

export function CollegeExamsPage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();
  const navigate = useNavigate();
  const entitled = checkEntitlement(context.entitlements, CollegeFeature.EXAMS);
  const role = context.membership.role;

  const examsQuery = useQuery(
    () =>
      entitled
        ? api.collegeExams.list(slug)
        : Promise.resolve({ items: [] }),
    [slug, entitled],
  );
  const treeQuery = useQuery(() => api.collegeOrgUnits.listTree(slug), [slug]);
  const flat = flattenTree(treeQuery.data?.items ?? []);
  const exams = examsQuery.data?.items ?? [];

  const [creating, setCreating] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [duplicating, setDuplicating] = useState<{ id: string } | null>(null);
  const [dupTitle, setDupTitle] = useState("");
  const [dupBusy, setDupBusy] = useState(false);

  const openDuplicate = (exam: CollegeExamSummary): void => {
    setDuplicating({ id: exam.id });
    setDupTitle(`Copy of ${exam.title}`);
  };

  const runDuplicate = async (): Promise<void> => {
    if (!duplicating || dupTitle.trim() === "") return;
    setDupBusy(true);
    try {
      await api.collegeExams.duplicate(slug, duplicating.id, dupTitle.trim());
      toast({ variant: "success", title: "Exam duplicated (as a draft)" });
      setDuplicating(null);
      examsQuery.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setDupBusy(false);
    }
  };

  const togglePublish = async (exam: CollegeExamSummary): Promise<void> => {
    setPublishingId(exam.id);
    try {
      await api.collegeExams.setPublished(slug, exam.id, !exam.isPublished);
      toast({
        variant: "success",
        title: exam.isPublished ? "Exam unpublished" : "Exam published",
      });
      examsQuery.refetch();
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
          title="Exams"
          description="Author and assign exams to your cohorts."
        />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <ClipboardCheck className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">
            Exams aren&apos;t enabled
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
        title="Campus Assessments"
        description="Author exams — sections, MCQ + coding questions, test cases — target them at cohorts, then publish for your students to take."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New exam
          </Button>
        }
      />

      {examsQuery.loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : examsQuery.error ? (
        <Alert variant="error">{examsQuery.error}</Alert>
      ) : exams.length === 0 ? (
        <EmptyState
          title="No exams yet"
          description="Create your first exam, add sections and questions, target the cohorts it's for, then publish it."
          icon={<ClipboardList />}
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New exam
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {exams.map((exam) => {
            const targets = summarizeTargets(exam.orgUnitIds, flat);
            return (
              <Card key={exam.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/c/${slug}/exams/${exam.id}`)}
                    className="min-w-0 text-left"
                  >
                    <h3 className="truncate font-semibold text-ink hover:text-primary">
                      {exam.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {exam.sectionCount} section
                      {exam.sectionCount === 1 ? "" : "s"} · {exam.questionCount}{" "}
                      question{exam.questionCount === 1 ? "" : "s"} ·{" "}
                      {exam.totalMarks} marks
                    </p>
                  </button>
                  {exam.isPublished ? (
                    <Badge variant="success">Published</Badge>
                  ) : (
                    <Badge variant="neutral">Draft</Badge>
                  )}
                </div>

                {/* Target-cohort chips */}
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
                    {exam.attemptCount} attempt
                    {exam.attemptCount === 1 ? "" : "s"} · pass{" "}
                    {exam.passPercentage}%
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        navigate(`/c/${slug}/exams/${exam.id}/results`)
                      }
                    >
                      <BarChart3 className="h-4 w-4" /> Results
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={publishingId === exam.id}
                      onClick={() => void togglePublish(exam)}
                    >
                      {exam.isPublished ? (
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
                      aria-label="Duplicate exam"
                      variant="ghost"
                      size="sm"
                      icon={<Copy className="h-4 w-4" />}
                      onClick={() => openDuplicate(exam)}
                    />
                    <IconButton
                      aria-label="Manage exam"
                      variant="ghost"
                      size="sm"
                      icon={<Settings2 className="h-4 w-4" />}
                      onClick={() => navigate(`/c/${slug}/exams/${exam.id}`)}
                    />
                    <IconButton
                      aria-label="Delete exam"
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                      onClick={() =>
                        setDeleting({ id: exam.id, title: exam.title })
                      }
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creating ? (
        <CollegeExamSettingsDialog
          open
          onOpenChange={setCreating}
          slug={slug}
          role={role}
          tree={treeQuery.data?.items ?? []}
          initial={null}
          onSaved={() => examsQuery.refetch()}
        />
      ) : null}

      <Dialog
        open={duplicating !== null}
        onOpenChange={(o) => {
          if (!o) setDuplicating(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate exam</DialogTitle>
            <DialogDescription>
              Copies the whole paper — sections, questions, and test cases — into
              a new <strong>unpublished draft</strong> with zero attempts. Public
              links are not copied.
            </DialogDescription>
          </DialogHeader>
          <FormField label="New exam title" required>
            <Input
              value={dupTitle}
              onChange={(e) => setDupTitle(e.target.value)}
              placeholder="e.g. Placement Mock — Set B"
              autoFocus
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDuplicating(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={dupBusy}
              disabled={dupTitle.trim() === ""}
              onClick={() => void runDuplicate()}
            >
              <Copy className="h-4 w-4" /> Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this exam?"
        noun="exam"
        description={
          <>
            This permanently deletes “{deleting?.title}” and all its sections,
            questions, test cases, and public links.
          </>
        }
        blockedHint="Delete a future/unattempted exam instead — this one has recorded attempts."
        onConfirm={() => api.collegeExams.remove(slug, deleting!.id)}
        onDeleted={() => {
          toast({ title: "Exam deleted" });
          examsQuery.refetch();
        }}
      />
    </div>
  );
}
