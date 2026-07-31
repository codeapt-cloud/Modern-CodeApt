/**
 * Bulk-import categorized questions into the GLOBAL bank (super-admin). Mirrors
 * the exam BulkUploadDialog, but posts to the Prompt-1 bank importer
 * (POST /admin/question-banks/import) with a base64 workbook + a `kind`
 * (mcq|coding), and downloads the categorized bank template. Shows the importer
 * report (created / skipped / row errors). This is where the seed files
 * (CodeApt_Bank_MCQ_400 / Coding_100) get uploaded. The importer is unchanged.
 */
import type { BankImportResponse, ExamBulkUploadKind } from "@codeapt/shared";
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
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs.js";
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

const HINT: Record<ExamBulkUploadKind, string> = {
  mcq: "Columns: category, subCategory, company, difficulty, tags, text, marks, option1–option5, correctOptions (1-based; comma-separate for multiple). One row = one MCQ.",
  coding:
    "Columns: category, subCategory, company, difficulty, tags, text, marks, starterCode, language, allowedLanguages, then input1/expected1/hidden1 … up to input5/expected5/hidden5. Test cases inline on the row.",
};

export function BankImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<ExamBulkUploadKind>("mcq");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<BankImportResponse | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const changeKind = (next: ExamBulkUploadKind): void => {
    setKind(next);
    setFile(null);
    setReport(null);
    setFormError("");
  };

  const downloadTemplate = async (): Promise<void> => {
    try {
      triggerBlobDownload(await api.adminQuestionBanks.template(kind));
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
      const result = await api.adminQuestionBanks.import(fileBase64, kind);
      setReport(result);
      toast({
        variant: "success",
        title: `Imported ${result.created} question${result.created === 1 ? "" : "s"}`,
      });
      onImported();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const label = kind === "mcq" ? "MCQ" : "coding";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import into the global bank</DialogTitle>
          <DialogDescription>
            Upload a categorized MCQ or coding workbook. Questions land in the
            global {label} bank, tagged by category / company / difficulty.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <Tabs
            value={kind}
            onValueChange={(v) => changeKind(v as ExamBulkUploadKind)}
          >
            <TabsList>
              <TabsTrigger value="mcq">MCQ bank</TabsTrigger>
              <TabsTrigger value="coding">Coding bank</TabsTrigger>
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
              <Download className="h-4 w-4" /> {label} template
            </Button>
          </div>

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
                <Stat label="Created" value={report.created} />
                <Stat label="Skipped (duplicates)" value={report.skipped} />
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
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
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
