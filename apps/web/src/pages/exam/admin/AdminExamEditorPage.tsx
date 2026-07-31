/**
 * Exam editor (route: /admin/exams/:examId). Loads the full authored tree and
 * manages its structure: exam settings (title / pass %), sections, questions
 * (type-adaptive), and CODE test cases. All mutations hit the real admin
 * endpoints and refetch; the server is authoritative.
 *
 * Power features (Excel bulk-upload, public links, results export, attempt
 * reset) are Step 2b — shown here as disabled placeholders only.
 */
import type { AdminExamDetail } from "@codeapt/shared";
import {
  ArrowLeft,
  Clock,
  Download,
  FileUp,
  Link2,
  Plus,
  RotateCcw,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { BulkUploadDialog } from "../../../components/exam/admin/BulkUploadDialog.js";
import { ExamSectionCard } from "../../../components/exam/admin/ExamSectionCard.js";
import { ExamSettingsDialog } from "../../../components/exam/admin/ExamSettingsDialog.js";
import { PublicLinksDialog } from "../../../components/exam/admin/PublicLinksDialog.js";
import { QuestionEditorDialog } from "../../../components/exam/admin/QuestionEditorDialog.js";
import { AttemptManagementDialog } from "../../../components/exam/admin/AttemptManagementDialog.js";
import { SectionEditorDialog } from "../../../components/exam/admin/SectionEditorDialog.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { useToast } from "../../../components/ui/toast.js";
import { api, parseApiError } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";

type Section = AdminExamDetail["sections"][number];
type Question = Section["questions"][number];

type DeleteTarget =
  | { kind: "section"; id: string; label: string }
  | { kind: "question"; id: string; label: string }
  | { kind: "test case"; id: string; label: string };

export function AdminExamEditorPage() {
  const { examId = "" } = useParams();
  const { toast } = useToast();
  const { data, loading, error, refetch } = useQuery(
    () => api.adminExams.get(examId),
    [examId],
  );

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
  const [resetOpen, setResetOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const downloadResults = async (): Promise<void> => {
    setDownloading(true);
    try {
      const { blob, filename } = await api.adminExams.resultsBlob(examId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Results downloaded" });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setDownloading(false);
    }
  };

  const performDelete = async (): Promise<void> => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "section") {
        await api.adminExams.deleteSection(confirm.id);
      } else if (confirm.kind === "question") {
        await api.adminExams.deleteQuestion(confirm.id);
      } else {
        await api.adminExams.deleteTestCase(confirm.id);
      }
      toast({ title: `Deleted ${confirm.kind}` });
      setConfirm(null);
      refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/admin/exams"
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> All exams
      </Link>

      {loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : !data ? null : (
        <>
          <PageHeader
            title={data.title}
            description={`${data.totalMarks} total marks · pass ${data.passPercentage}% · ${data.sections.length} section${data.sections.length === 1 ? "" : "s"}`}
            actions={
              <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
                <Settings className="h-4 w-4" /> Exam settings
              </Button>
            }
          />

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
            <Button
              variant="ghost"
              size="sm"
              loading={downloading}
              onClick={() => void downloadResults()}
            >
              <Download className="h-4 w-4" /> Download results
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
              <RotateCcw className="h-4 w-4" /> Attempt management
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
                  onChanged={refetch}
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
          {settingsOpen ? (
            <ExamSettingsDialog
              open
              onOpenChange={setSettingsOpen}
              initial={data}
              onSaved={() => refetch()}
            />
          ) : null}

          {addSectionOpen ? (
            <SectionEditorDialog
              open
              onOpenChange={setAddSectionOpen}
              examId={data.id}
              nextOrder={data.sections.length}
              onSaved={() => refetch()}
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
              initial={{
                id: editSectionFor.id,
                name: editSectionFor.name,
                order: editSectionFor.order,
                durationMinutes: editSectionFor.durationMinutes,
                description: editSectionFor.description,
              }}
              onSaved={() => refetch()}
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
              onSaved={refetch}
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
              onSaved={refetch}
            />
          ) : null}

          {bulkOpen ? (
            <BulkUploadDialog
              open
              onOpenChange={setBulkOpen}
              examId={data.id}
              onUploaded={refetch}
            />
          ) : null}

          {linksOpen ? (
            <PublicLinksDialog
              open
              onOpenChange={setLinksOpen}
              examId={data.id}
              links={data.publicLinks}
              onChanged={refetch}
            />
          ) : null}

          {resetOpen ? (
            <AttemptManagementDialog
              open
              onOpenChange={setResetOpen}
              examId={data.id}
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
