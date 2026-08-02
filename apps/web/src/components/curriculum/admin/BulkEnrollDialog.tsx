/**
 * Bulk-enroll students from an .xlsx roster across one or more courses. Mirrors
 * BulkUploadTopicsDialog: the roster is base64-encoded into the JSON body
 * (POST /admin/enrollments/bulk-upload) with the selected subjectIds, and the
 * response is a per-row report { createdUsers, enrolledCount, errors[] }.
 *
 * Security-relevant fact surfaced in the report: newly-created accounts get a
 * shared default password and are forced to reset it on first login — so the
 * admin knows to communicate that to the cohort.
 */
import type { BulkEnrollResponse } from "@codeapt/shared";
import { Download, FileUp, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { triggerBlobDownload } from "../../../lib/download.js";
import { useQuery } from "../../../lib/use-query.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import { Checkbox } from "../../ui/checkbox.js";
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

export interface BulkEnrollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected course (e.g. the subject editor you opened this from). */
  defaultSubjectId?: string;
  onDone?: () => void;
}

export function BulkEnrollDialog({
  open,
  onOpenChange,
  defaultSubjectId,
  onDone,
}: BulkEnrollDialogProps) {
  const { toast } = useToast();
  const { data: subjectsData } = useQuery(
    () => api.adminCurriculum.subjects.list(),
    [],
  );
  const subjects = subjectsData?.items ?? [];

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultSubjectId ? [defaultSubjectId] : []),
  );
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<BulkEnrollResponse | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const downloadTemplate = async (): Promise<void> => {
    try {
      triggerBlobDownload(
        await api.adminCurriculum.enrollments.bulkUploadTemplate(),
      );
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    }
  };

  const submit = async (): Promise<void> => {
    if (!file || selected.size === 0) return;
    setFormError("");
    setReport(null);
    setSubmitting(true);
    try {
      const fileBase64 = await readAsBase64(file);
      const result = await api.adminCurriculum.enrollments.bulkUpload(
        [...selected],
        fileBase64,
      );
      setReport(result);
      toast({
        variant: "success",
        title: `${result.enrolledCount} enrollment${result.enrolledCount === 1 ? "" : "s"} added`,
      });
      onDone?.();
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
          <DialogTitle>Bulk enroll students</DialogTitle>
          <DialogDescription>
            Upload an .xlsx roster to provision students and enroll them across
            the selected courses. New accounts are created as needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <Alert variant="warning" title="New accounts get a default password">
            Students created by this import are given a shared default password
            and <strong>must reset it on first login</strong> before they can
            access anything. Tell the cohort to change it.
          </Alert>

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-ink-muted">
              New here? Start from the sample roster.
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

          <div>
            <p className="mb-2 text-sm font-medium text-ink">
              Enroll into these courses
            </p>
            <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-xl border border-subtle bg-surface-base p-3">
              {subjects.length === 0 ? (
                <p className="text-xs text-ink-muted">No courses yet.</p>
              ) : (
                subjects.map((s) => (
                  <label key={s.id} className="flex items-center gap-3 text-sm">
                    <Checkbox
                      checked={selected.has(s.id)}
                      onCheckedChange={() => toggle(s.id)}
                      aria-label={`Enroll into ${s.name}`}
                    />
                    <span className="text-ink">{s.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-subtle bg-surface-base p-8 text-center hover:border-primary/60">
            <FileUp className="h-6 w-6 text-primary" />
            <span className="text-sm text-ink">
              {file ? file.name : "Choose an .xlsx roster"}
            </span>
            <span className="text-xs text-ink-muted">
              Columns: username, email, full_name, college_name, roll_number,
              phone_number, state, bio
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
                <Stat label="New accounts" value={report.createdUsers} />
                <Stat label="Enrollments added" value={report.enrolledCount} />
                <Stat label="Row errors" value={report.errors.length} />
              </div>
              {report.createdUsers > 0 ? (
                <p className="flex items-center gap-2 text-xs text-warning-fg">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {report.createdUsers} new account
                  {report.createdUsers === 1 ? "" : "s"} created with the default
                  password — they must reset it on first login.
                </p>
              ) : null}
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
                  No row errors — all rows processed.
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
            disabled={!file || selected.size === 0}
            onClick={() => void submit()}
          >
            <FileUp className="h-4 w-4" /> Upload roster
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
