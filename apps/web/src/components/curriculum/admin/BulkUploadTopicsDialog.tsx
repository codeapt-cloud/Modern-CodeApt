/**
 * Bulk-import text/video topics for a subject from an .xlsx workbook. Mirrors
 * the exam BulkUploadDialog: the workbook is base64-encoded into the JSON body
 * (POST /admin/subjects/:subjectId/topics/bulk-upload) and the response is a
 * per-row report { createdModules, createdTopics, errors[] } — partial success,
 * so valid rows import even when others fail.
 *
 * Scope (matches the original importer): TEXT and VIDEO topics only. Modules are
 * get-or-created by name. quiz/exam/essay rows are reported as errors, never
 * silently skipped — those carry sub-trees/linkages authored individually.
 */
import type { TopicExcelUploadResponse } from "@codeapt/shared";
import { Download, FileUp } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { triggerBlobDownload } from "../../../lib/download.js";
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
import { useToast } from "../../ui/toast.js";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export interface BulkUploadTopicsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectId: string;
  onUploaded: () => void;
}

export function BulkUploadTopicsDialog({
  open,
  onOpenChange,
  subjectId,
  onUploaded,
}: BulkUploadTopicsDialogProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<TopicExcelUploadResponse | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const downloadTemplate = async (): Promise<void> => {
    try {
      triggerBlobDownload(await api.adminCurriculum.topics.bulkUploadTemplate());
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
      const result = await api.adminCurriculum.topics.bulkUpload(
        subjectId,
        fileBase64,
      );
      setReport(result);
      toast({
        variant: "success",
        title: `Imported ${result.createdTopics} topic${result.createdTopics === 1 ? "" : "s"}`,
      });
      onUploaded();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk upload topics</DialogTitle>
          <DialogDescription>
            Upload an .xlsx workbook with a “Topics” sheet. Modules are created by
            name as needed. Text and video topics only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <Alert variant="warning">
            Only <strong>text</strong> and <strong>video</strong> topics import
            in bulk. Quiz, exam, and essay topics are reported as row errors —
            author those individually (they carry questions / exam links).
          </Alert>

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-ink-muted">
              New here? Start from the sample workbook.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void downloadTemplate()}
            >
              <Download className="h-4 w-4" /> Template
            </Button>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-subtle bg-surface-base p-8 text-center hover:border-primary/60">
            <FileUp className="h-6 w-6 text-primary" />
            <span className="text-sm text-ink">
              {file ? file.name : "Choose an .xlsx workbook"}
            </span>
            <span className="text-xs text-ink-muted">
              Columns: module, name, type (text/video), content, video_id (or
              video_url), duration, order
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
                <Stat label="Modules created" value={report.createdModules} />
                <Stat label="Topics created" value={report.createdTopics} />
                <Stat label="Row errors" value={report.errors.length} />
              </div>
              {report.errors.length > 0 ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                  {report.errors.map((e, i) => (
                    <li key={i} className="text-error-fg">
                      Row {e.row}: {e.message}
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
            <FileUp className="h-4 w-4" /> Upload
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
