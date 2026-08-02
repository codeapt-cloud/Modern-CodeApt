/**
 * Bulk-upload questions from an .xlsx workbook — TWO simple, separate,
 * single-sheet formats picked with a toggle: MCQ or Coding. Each has its own
 * downloadable template with only the columns that type needs; coding test cases
 * are INLINE on the row (up to 5) — no second sheet, no `ref` linking.
 * POST /admin/exams/:examId/bulk-upload (or the tenant route via authApi) takes
 * the base64 workbook + a `kind` and returns a per-row report
 * { createdSections, createdQuestions, createdTestCases, errors[] }.
 *
 * NOTE: question images are not imported (exam image storage is undecided — the
 * original used Cloudinary). Everything else imports normally.
 */
import type { ExamBulkUploadKind, ExcelUploadResponse } from "@codeapt/shared";
import { Download, FileUp } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { triggerBlobDownload } from "../../../lib/download.js";
import type { ExamAuthoringApi } from "../../../lib/exam-authoring-api.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs.js";
import { useToast } from "../../ui/toast.js";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const result = String(reader.result);
      // Strip the "data:...;base64," prefix.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

const HINT: Record<ExamBulkUploadKind, string> = {
  mcq: "Columns: section, sectionDuration, order, text, marks, option1–option5, correctOptions (1-based; comma-separate for multiple correct answers). One row = one MCQ.",
  coding:
    "Columns: section, sectionDuration, order, text, marks, starterCode, language, allowedLanguages, then input1/expected1/hidden1 … up to input5/expected5/hidden5. Test cases are inline on the row — leave a triple blank to use fewer than 5.",
};

export function BulkUploadDialog({
  open,
  onOpenChange,
  examId,
  onUploaded,
  authApi = api.adminExams,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  onUploaded: () => void;
  /** Authoring backend — defaults to the platform admin api; the college editor
   * injects a slug-bound tenant adapter. */
  authApi?: ExamAuthoringApi;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<ExamBulkUploadKind>("mcq");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ExcelUploadResponse | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Switching type is a fresh start — a file for one format must not upload as
  // the other.
  const changeKind = (next: ExamBulkUploadKind): void => {
    setKind(next);
    setFile(null);
    setReport(null);
    setFormError("");
  };

  const downloadTemplate = async (): Promise<void> => {
    try {
      triggerBlobDownload(await authApi.bulkUploadTemplate(kind));
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    }
  };

  const submit = async (): Promise<void> => {
    if (!file) return;
    setFormError("");
    setReport(null);
    setSubmitting(true);
    try {
      const fileBase64 = await readAsBase64(file);
      const result = await authApi.bulkUpload(examId, fileBase64, kind);
      setReport(result);
      toast({
        variant: "success",
        title: `Imported ${result.createdQuestions} question${result.createdQuestions === 1 ? "" : "s"}`,
      });
      onUploaded();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const label = kind === "mcq" ? "MCQ" : "coding";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk upload questions</DialogTitle>
          <DialogDescription>
            Pick a question type, download its template, fill it in, and upload.
            Sections are created by name as needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <Tabs value={kind} onValueChange={(v) => changeKind(v as ExamBulkUploadKind)}>
            <TabsList>
              <TabsTrigger value="mcq">MCQ questions</TabsTrigger>
              <TabsTrigger value="coding">Coding questions</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">{HINT[kind]}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={() => void downloadTemplate()}
            >
              <Download className="h-4 w-4" /> {kind === "mcq" ? "MCQ" : "Coding"}{" "}
              template
            </Button>
          </div>

          <Alert variant="warning">
            Question images are not imported — exam image storage is undecided
            (the original used Cloudinary). Everything else imports normally.
          </Alert>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-subtle bg-surface-base p-8 text-center hover:border-primary/60">
            <FileUp className="h-6 w-6 text-primary" />
            <span className="text-sm text-ink">
              {file ? file.name : `Choose the filled ${label} .xlsx workbook`}
            </span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                setReport(null);
                setFile(e.target.files?.[0] ?? null);
              }}
            />
          </label>

          {report ? (
            <div className="space-y-3 rounded-xl border border-subtle bg-surface-base p-4">
              <div className="flex flex-wrap gap-4 text-sm">
                <Stat label="Sections" value={report.createdSections} />
                <Stat label="Questions" value={report.createdQuestions} />
                <Stat label="Test cases" value={report.createdTestCases} />
                <Stat label="Row errors" value={report.errors.length} />
              </div>
              {report.errors.length > 0 ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                  {report.errors.map((e, i) => (
                    <li key={i} className="text-error-fg">
                      {e.sheet} row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-success-fg">
                  No row errors — all rows imported.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {report ? "Close" : "Cancel"}
          </Button>
          <Button
            type="button"
            loading={submitting}
            disabled={!file}
            onClick={() => void submit()}
          >
            <FileUp className="h-4 w-4" /> Upload {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-mono text-lg font-bold text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}
