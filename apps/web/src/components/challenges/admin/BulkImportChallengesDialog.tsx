/**
 * Bulk-import daily challenges from an .xlsx workbook. Mirrors the curriculum
 * BulkUploadTopicsDialog: the workbook is base64-encoded into the JSON body
 * (POST /admin/challenges/bulk-import) and the response is a per-row report
 * { scheduled, errors[] } — partial success, so valid rows import even when
 * others fail.
 *
 * Scheduling (deliberate, since the original importer is unrecoverable): a
 * start date ⇒ SEQUENTIAL (row order → consecutive days); no start date ⇒ each
 * row's `date` column is EXPLICIT. A date already taken (in the DB or earlier in
 * the sheet) is reported as a row error and skipped — never overwritten.
 */
import type { AdminChallengeBulkImportResponse } from "@codeapt/shared";
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
import { FormField } from "../../ui/form-field.js";
import { Input } from "../../ui/input.js";
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

export interface BulkImportChallengesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}

export function BulkImportChallengesDialog({
  open,
  onOpenChange,
  onUploaded,
}: BulkImportChallengesDialogProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [startDate, setStartDate] = useState("");
  const [report, setReport] =
    useState<AdminChallengeBulkImportResponse | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const downloadTemplate = async (): Promise<void> => {
    try {
      triggerBlobDownload(await api.adminChallenges.bulkImportTemplate());
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
      const result = await api.adminChallenges.bulkImport(
        fileBase64,
        startDate || undefined,
      );
      setReport(result);
      toast({
        variant: "success",
        title: `Scheduled ${result.scheduled} challenge${result.scheduled === 1 ? "" : "s"}`,
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
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk import challenges</DialogTitle>
          <DialogDescription>
            Upload an .xlsx workbook with a “Challenges” sheet. One challenge is
            scheduled per day.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <Alert variant="info">
            Set a <strong>start date</strong> to schedule rows sequentially (row
            order → consecutive days). Leave it blank to use each row&rsquo;s own{" "}
            <strong>date</strong> column. A date already scheduled is reported as
            a row error and skipped — never overwritten.
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

          <FormField
            label="Start date (optional)"
            hint="Present → sequential scheduling; blank → explicit per-row dates."
          >
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setReport(null);
                setStartDate(e.target.value);
              }}
            />
          </FormField>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-subtle bg-surface-base p-8 text-center hover:border-primary/60">
            <FileUp className="h-6 w-6 text-primary" />
            <span className="text-sm text-ink">
              {file ? file.name : "Choose an .xlsx workbook"}
            </span>
            <span className="text-xs text-ink-muted">
              Columns: type (mcq/code), date, title, description, marks; MCQ:
              options (pipe-separated) + correct (1-based); CODE: starter_code,
              language, cases (“input=&gt;expected” per line, “*” = hidden)
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
                <Stat label="Scheduled" value={report.scheduled} />
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
                  No row errors — all rows scheduled.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {report ? "Close" : "Cancel"}
          </Button>
          <Button
            type="button"
            loading={submitting}
            disabled={!file}
            onClick={() => void submit()}
          >
            <FileUp className="h-4 w-4" /> Import
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
