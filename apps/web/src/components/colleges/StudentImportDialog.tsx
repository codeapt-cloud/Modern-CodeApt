/**
 * Interactive student bulk-import (the Phase 3b centerpiece) — clear + safe.
 * Three steps:
 *   1) INPUT — paste a table OR upload a CSV/TSV; both are parsed CLIENT-SIDE by
 *      the pure parseStudentRows into the SAME StudentImportRowInput[]. A
 *      "Download template" button GETs the 3a template CSV. Shows "N rows
 *      detected".
 *   2) PREVIEW — POST rows to import/preview; render a per-row verdict table
 *      (errors sorted first) with OK/Error badges + specific reasons, and the
 *      summary. Nothing is written — this is the safety moment.
 *   3) COMMIT — "Import N valid students" sends the rows to import/commit; the
 *      backend creates only the ok rows. Shows created/skipped/failed and
 *      refreshes the list. Users can go back, fix, and re-preview without losing
 *      their text.
 *
 * Rides the 3a backend as-is; both input modes feed one preview/commit pipeline.
 */
import type {
  StudentImportCommitResponse,
  StudentImportPreviewResponse,
} from "@codeapt/shared";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { api, parseApiError } from "../../lib/api-client.js";
import { triggerBlobDownload } from "../../lib/download.js";
import { parseStudentRows } from "../../lib/student-import-ui.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Textarea } from "../ui/textarea.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table.js";
import { useToast } from "../ui/toast.js";

type Step = "input" | "preview" | "result";

export interface StudentImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  /** Called after a successful commit so the caller can refresh the list. */
  onCommitted: () => void;
}

export function StudentImportDialog({
  open,
  onOpenChange,
  slug,
  onCommitted,
}: StudentImportDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("input");
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StudentImportPreviewResponse | null>(
    null,
  );
  const [result, setResult] = useState<StudentImportCommitResponse | null>(
    null,
  );

  const parsed = useMemo(() => parseStudentRows(text), [text]);

  const resetAll = () => {
    setStep("input");
    setText("");
    setFileName("");
    setPreview(null);
    setResult(null);
  };

  const close = (o: boolean) => {
    if (!o) resetAll();
    onOpenChange(o);
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setText(content);
    setFileName(file.name);
  };

  const downloadTemplate = async () => {
    try {
      triggerBlobDownload(await api.collegeStudents.template(slug));
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    }
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      const res = await api.collegeStudents.importPreview(slug, parsed.rows);
      setPreview(res);
      setStep("preview");
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    setBusy(true);
    try {
      const res = await api.collegeStudents.importCommit(slug, parsed.rows);
      setResult(res);
      setStep("result");
      onCommitted();
      toast({
        variant: "success",
        title: `Imported ${res.summary.created} student${
          res.summary.created === 1 ? "" : "s"
        }`,
      });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const okCount = preview?.summary.ok ?? 0;

  // Errors first, then original order — makes problems scannable.
  const sortedVerdicts = preview
    ? [...preview.rows].sort((a, b) => {
        if (a.status === b.status) return a.index - b.index;
        return a.status === "error" ? -1 : 1;
      })
    : [];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import students</DialogTitle>
          <DialogDescription>
            {step === "input"
              ? "Paste a table or upload a CSV, then preview before importing."
              : step === "preview"
                ? "Review each row. Only valid rows will be imported."
                : "Import complete."}
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1 — INPUT */}
        {step === "input" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-ink-muted">
                Columns: <span className="font-mono">fullName, email,
                rollNumber, orgUnit</span>. Org-unit is a path (e.g.{" "}
                <span className="font-mono">CSE / 2026 / A</span>) or a unique
                name.
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

            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as "paste" | "upload")}
            >
              <TabsList>
                <TabsTrigger value="paste">Paste</TabsTrigger>
                <TabsTrigger value="upload">Upload file</TabsTrigger>
              </TabsList>

              <TabsContent value="paste">
                <Textarea
                  className="min-h-40 font-mono text-xs"
                  placeholder={
                    "Paste rows here (CSV, or copied straight from a spreadsheet).\nA header row is optional.\n\nAsha Rao,asha@college.edu,CS2026001,CSE / 2026 / A"
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </TabsContent>

              <TabsContent value="upload">
                <div className="rounded-xl border border-dashed border-strong p-6 text-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv"
                    className="hidden"
                    onChange={(e) => void onPickFile(e.target.files?.[0])}
                  />
                  <Upload className="mx-auto mb-2 h-8 w-8 text-ink-muted" />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose CSV / TSV file
                  </Button>
                  {fileName ? (
                    <p className="mt-2 text-sm text-ink-secondary">
                      {fileName}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-ink-muted">
                      CSV or tab-separated. A header row is optional.
                    </p>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">
                {parsed.rows.length === 0
                  ? "No rows detected yet"
                  : `${parsed.rows.length} row${
                      parsed.rows.length === 1 ? "" : "s"
                    } detected${parsed.hadHeader ? " (header skipped)" : ""}`}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button
                  loading={busy}
                  disabled={parsed.rows.length === 0}
                  onClick={() => void runPreview()}
                >
                  Preview {parsed.rows.length || ""}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* STEP 2 — PREVIEW */}
        {step === "preview" && preview ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="success">
                <CheckCircle2 className="h-3.5 w-3.5" /> {preview.summary.ok} ok
              </Badge>
              <Badge variant={preview.summary.errors > 0 ? "error" : "neutral"}>
                <AlertTriangle className="h-3.5 w-3.5" />{" "}
                {preview.summary.errors} error
                {preview.summary.errors === 1 ? "" : "s"}
              </Badge>
              <span className="text-sm text-ink-muted">
                {preview.summary.total} total
              </span>
            </div>

            <div className="max-h-[46vh] overflow-auto rounded-xl border border-subtle">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Roll</TableHead>
                    <TableHead>Org-unit</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedVerdicts.map((r) => (
                    <TableRow
                      key={r.index}
                      className={r.status === "error" ? "bg-error-subtle/40" : ""}
                    >
                      <TableCell className="text-xs text-ink-muted">
                        {r.index + 1}
                      </TableCell>
                      <TableCell className="text-sm text-ink">
                        {r.fullName || <span className="text-ink-muted">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-ink-secondary">
                        {r.email || <span className="text-ink-muted">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-ink-secondary">
                        {r.rollNumber || (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-ink-secondary">
                        {r.orgUnit || <span className="text-ink-muted">—</span>}
                      </TableCell>
                      <TableCell>
                        {r.status === "ok" ? (
                          <Badge variant="success">OK</Badge>
                        ) : (
                          <div className="space-y-1">
                            <Badge variant="error">Error</Badge>
                            <ul className="list-disc pl-4 text-[11px] text-error-fg">
                              {r.errors.map((e, i) => (
                                <li key={i}>{e}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setStep("input")}
                disabled={busy}
              >
                Back to edit
              </Button>
              <Button
                loading={busy}
                disabled={okCount === 0}
                onClick={() => void runCommit()}
              >
                Import {okCount} valid student{okCount === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {/* STEP 3 — RESULT */}
        {step === "result" && result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="success">{result.summary.created} created</Badge>
              <Badge variant={result.summary.skipped > 0 ? "warning" : "neutral"}>
                {result.summary.skipped} skipped
              </Badge>
              {result.summary.failed > 0 ? (
                <Badge variant="error">{result.summary.failed} failed</Badge>
              ) : null}
            </div>

            {result.skipped.length > 0 || result.failed.length > 0 ? (
              <div className="max-h-[40vh] space-y-3 overflow-auto">
                {[...result.skipped, ...result.failed].length > 0 ? (
                  <div className="rounded-xl border border-subtle p-3">
                    <p className="mb-2 text-sm font-medium text-ink">
                      Not imported
                    </p>
                    <ul className="space-y-1 text-sm text-ink-secondary">
                      {result.skipped.map((s) => (
                        <li key={`s-${s.index}`}>
                          <span className="font-mono text-xs">
                            #{s.index + 1} {s.rollNumber || "—"}
                          </span>{" "}
                          — {s.reason}
                        </li>
                      ))}
                      {result.failed.map((f) => (
                        <li key={`f-${f.index}`} className="text-error-fg">
                          <span className="font-mono text-xs">
                            #{f.index + 1} {f.rollNumber || "—"}
                          </span>{" "}
                          — {f.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <Alert variant="success">
                All valid rows were imported successfully.
              </Alert>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={resetAll}>
                Import more
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
