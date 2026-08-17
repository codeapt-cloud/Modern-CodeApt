/**
 * College exam editor (route: /c/:slug/exams/:examId). Reuses the platform-admin
 * exam-authoring components (ExamSectionCard, Section/Question editors,
 * TestCaseEditor, BulkUpload, PublicLinks) pointed at the TENANT endpoints via an
 * injected slug-bound `authApi` — so the authored tree (sections → MCQ/CODE
 * questions → test cases → timing → marks) is edited identically to the admin
 * surface, with NO forked editor. The college-specific bits live here: exam
 * settings with org-unit TARGETING, and the draft→published lifecycle (publish
 * needs ≥1 question — surfaced before the server 400s).
 *
 * The authored tree comes from GET /c/:slug/exams/:id (the shared AdminExamDetail);
 * the lifecycle + targeting fields (isPublished, orgUnitIds, attemptCount) come
 * from the tenant list summary (AdminExamDetail doesn't carry them).
 */
import {
  CollegeFeature,
  checkEntitlement,
  type AdminExamDetail,
} from "@codeapt/shared";
import {
  ArrowLeft,
  BarChart3,
  Clock,
  Eye,
  EyeOff,
  FileUp,
  Link2,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { FullExamAIBuildDialog } from "../../components/colleges/exams/FullExamAIBuildDialog.js";
import { CollegeExamSettingsDialog } from "../../components/colleges/exams/CollegeExamSettingsDialog.js";
import { SectionBankButtons } from "../../components/colleges/exams/SectionBankButtons.js";
import { BulkUploadDialog } from "../../components/exam/admin/BulkUploadDialog.js";
import { ExamSectionCard } from "../../components/exam/admin/ExamSectionCard.js";
import { PublicLinksDialog } from "../../components/exam/admin/PublicLinksDialog.js";
import { QuestionEditorDialog } from "../../components/exam/admin/QuestionEditorDialog.js";
import { SectionEditorDialog } from "../../components/exam/admin/SectionEditorDialog.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { collegeExamAuthoringApi } from "../../lib/exam-authoring-api.js";
import { summarizeTargets } from "../../lib/exam-targeting.js";
import { flattenTree } from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

type Section = AdminExamDetail["sections"][number];
type Question = Section["questions"][number];

type DeleteTarget =
  | { kind: "section"; id: string; label: string }
  | { kind: "question"; id: string; label: string }
  | { kind: "test case"; id: string; label: string };

export function CollegeExamEditorPage() {
  const { slug, context } = useCollege();
  const { examId = "" } = useParams();
  const { toast } = useToast();
  const role = context.membership.role;
  const authApi = useMemo(() => collegeExamAuthoringApi(slug), [slug]);
  // Standard/Coding bank pickers need the global-bank grant; the Self Bank is
  // always available (the college's own data).
  const banksGranted = checkEntitlement(
    context.entitlements,
    CollegeFeature.QUESTION_BANKS,
  );

  const detailQuery = useQuery(
    () => api.collegeExams.get(slug, examId),
    [slug, examId],
  );
  const listQuery = useQuery(() => api.collegeExams.list(slug), [slug]);
  const treeQuery = useQuery(() => api.collegeOrgUnits.listTree(slug), [slug]);

  const data = detailQuery.data;
  const summary = listQuery.data?.items.find((e) => e.id === examId) ?? null;
  const flat = flattenTree(treeQuery.data?.items ?? []);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [editSectionFor, setEditSectionFor] = useState<Section | null>(null);
  const [addQuestionFor, setAddQuestionFor] = useState<Section | null>(null);
  const [editQuestionFor, setEditQuestionFor] = useState<{
    section: Section;
    question: Question;
  } | null>(null);
  const [confirm, setConfirm] = useState<DeleteTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const refetchAll = (): void => {
    detailQuery.refetch();
    listQuery.refetch();
  };

  const questionCount =
    data?.sections.reduce((n, s) => n + s.questions.length, 0) ?? 0;

  const togglePublish = async (): Promise<void> => {
    if (!summary) return;
    setPublishing(true);
    try {
      await api.collegeExams.setPublished(slug, examId, !summary.isPublished);
      toast({
        variant: "success",
        title: summary.isPublished ? "Exam unpublished" : "Exam published",
      });
      listQuery.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setPublishing(false);
    }
  };

  const performDelete = async (): Promise<void> => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "section") {
        await authApi.deleteSection(confirm.id);
      } else if (confirm.kind === "question") {
        await authApi.deleteQuestion(confirm.id);
      } else {
        await authApi.deleteTestCase(confirm.id);
      }
      toast({ title: `Deleted ${confirm.kind}` });
      setConfirm(null);
      refetchAll();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const targets = summary ? summarizeTargets(summary.orgUnitIds, flat) : null;

  return (
    <div className="space-y-6">
      <Link
        to={`/c/${slug}/exams`}
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> All exams
      </Link>

      {detailQuery.loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : detailQuery.error ? (
        <Alert variant="error">{detailQuery.error}</Alert>
      ) : !data ? null : (
        <>
          <PageHeader
            title={data.title}
            description={`${data.totalMarks} total marks · pass ${data.passPercentage}% · ${data.sections.length} section${data.sections.length === 1 ? "" : "s"}`}
            actions={
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings className="h-4 w-4" /> Exam settings
                </Button>
                <Button
                  loading={publishing}
                  disabled={!summary || (!summary.isPublished && questionCount === 0)}
                  onClick={() => void togglePublish()}
                >
                  {summary?.isPublished ? (
                    <>
                      <EyeOff className="h-4 w-4" /> Unpublish
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4" /> Publish
                    </>
                  )}
                </Button>
              </div>
            }
          />

          {/* Lifecycle + targeting summary */}
          <div className="flex flex-wrap items-center gap-2">
            {summary?.isPublished ? (
              <Badge variant="success">Published</Badge>
            ) : (
              <Badge variant="neutral">Draft</Badge>
            )}
            {targets?.collegeWide ? (
              <Badge variant="info">College-wide</Badge>
            ) : (
              targets?.labels.map((label, i) => (
                <Badge key={i} variant="neutral">
                  {label}
                </Badge>
              ))
            )}
            {!summary?.isPublished && questionCount === 0 ? (
              <span className="text-xs text-ink-muted">
                Add at least one question to publish.
              </span>
            ) : null}
          </div>

          {/* Power tools */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-subtle bg-surface-base p-3">
            <span className="mr-1 text-xs font-medium text-ink-muted">
              Power tools
            </span>
            <Button variant="ghost" size="sm" onClick={() => setBulkOpen(true)}>
              <FileUp className="h-4 w-4" /> Bulk upload
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLinksOpen(true)}>
              <Link2 className="h-4 w-4" /> Public links
              {data.publicLinks.length > 0 ? (
                <Badge variant="neutral">{data.publicLinks.length}</Badge>
              ) : null}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAiOpen(true)}>
              <Sparkles className="h-4 w-4" /> Full Exam AI Build
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/c/${slug}/exams/${examId}/results`}>
                <BarChart3 className="h-4 w-4" /> Results
              </Link>
            </Button>
          </div>

          {/* Sections */}
          {data.sections.length === 0 ? (
            <EmptyState
              title="No sections yet"
              description="Add a section, then add questions to it."
              icon={<Clock />}
              action={
                <Button size="sm" onClick={() => setAddSectionOpen(true)}>
                  <Plus className="h-4 w-4" /> Add section
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {data.sections.map((section) => (
                <ExamSectionCard
                  key={section.id}
                  section={section}
                  authApi={authApi}
                  headerActions={
                    <SectionBankButtons
                      slug={slug}
                      examId={data.id}
                      sectionId={section.id}
                      sectionName={section.name}
                      granted={banksGranted}
                      onAdded={refetchAll}
                    />
                  }
                  onAddQuestion={() => setAddQuestionFor(section)}
                  onEditSection={() => setEditSectionFor(section)}
                  onEditQuestion={(q) =>
                    setEditQuestionFor({ section, question: q })
                  }
                  onDeleteSection={() =>
                    setConfirm({
                      kind: "section",
                      id: section.id,
                      label: section.name,
                    })
                  }
                  onDeleteQuestion={(q) =>
                    setConfirm({
                      kind: "question",
                      id: q.id,
                      label: q.text.slice(0, 60) || "question",
                    })
                  }
                  onRequestDeleteTestCase={(id) =>
                    setConfirm({ kind: "test case", id, label: "test case" })
                  }
                  onChanged={refetchAll}
                />
              ))}
            </div>
          )}

          {data.sections.length > 0 ? (
            <Button variant="secondary" onClick={() => setAddSectionOpen(true)}>
              <Plus className="h-4 w-4" /> Add section
            </Button>
          ) : null}

          {/* Dialogs */}
          {settingsOpen && summary ? (
            <CollegeExamSettingsDialog
              open
              onOpenChange={setSettingsOpen}
              slug={slug}
              role={role}
              tree={treeQuery.data?.items ?? []}
              initial={{
                id: data.id,
                title: data.title,
                passPercentage: data.passPercentage,
                calculatorEnabled: data.calculatorEnabled,
                shuffleQuestions: data.shuffleQuestions,
                shuffleOptions: data.shuffleOptions,
                accessCodeEnabled: data.accessCodeEnabled,
                accessCode: data.accessCode,
                orgUnitIds: summary.orgUnitIds,
              }}
              onSaved={refetchAll}
            />
          ) : null}

          {addSectionOpen ? (
            <SectionEditorDialog
              open
              onOpenChange={setAddSectionOpen}
              examId={data.id}
              nextOrder={data.sections.length}
              authApi={authApi}
              onSaved={refetchAll}
            />
          ) : null}

          {editSectionFor ? (
            <SectionEditorDialog
              key={`edit-section-${editSectionFor.id}`}
              open
              onOpenChange={(o) => {
                if (!o) setEditSectionFor(null);
              }}
              examId={data.id}
              nextOrder={editSectionFor.order}
              authApi={authApi}
              initial={{
                id: editSectionFor.id,
                name: editSectionFor.name,
                order: editSectionFor.order,
                durationMinutes: editSectionFor.durationMinutes,
                description: editSectionFor.description,
              }}
              onSaved={refetchAll}
            />
          ) : null}

          {addQuestionFor ? (
            <QuestionEditorDialog
              key={addQuestionFor.id}
              open
              onOpenChange={(o) => {
                if (!o) setAddQuestionFor(null);
              }}
              sectionId={addQuestionFor.id}
              sectionName={addQuestionFor.name}
              order={addQuestionFor.questions.length}
              authApi={authApi}
              onSaved={refetchAll}
            />
          ) : null}

          {editQuestionFor ? (
            <QuestionEditorDialog
              key={`edit-${editQuestionFor.question.id}`}
              open
              onOpenChange={(o) => {
                if (!o) setEditQuestionFor(null);
              }}
              sectionId={editQuestionFor.section.id}
              sectionName={editQuestionFor.section.name}
              order={editQuestionFor.question.order}
              initial={editQuestionFor.question}
              authApi={authApi}
              onSaved={refetchAll}
            />
          ) : null}

          {bulkOpen ? (
            <BulkUploadDialog
              open
              onOpenChange={setBulkOpen}
              examId={data.id}
              authApi={authApi}
              onUploaded={refetchAll}
            />
          ) : null}

          {linksOpen ? (
            <PublicLinksDialog
              open
              onOpenChange={setLinksOpen}
              examId={data.id}
              links={data.publicLinks}
              authApi={authApi}
              onChanged={refetchAll}
            />
          ) : null}

          {aiOpen ? (
            <FullExamAIBuildDialog
              open
              onOpenChange={setAiOpen}
              slug={slug}
              examId={data.id}
              hasExistingSections={data.sections.length > 0}
              onGenerated={refetchAll}
            />
          ) : null}
        </>
      )}

      {/* Unified delete confirm (sections, questions, test cases) */}
      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirm?.kind}?</DialogTitle>
            <DialogDescription>
              {confirm?.kind === "section"
                ? `“${confirm?.label}” and all its questions and test cases will be permanently deleted.`
                : confirm?.kind === "question"
                  ? `This question and its test cases will be permanently deleted.`
                  : `This test case will be permanently deleted.`}{" "}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={() => void performDelete()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
