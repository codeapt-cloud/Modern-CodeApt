/**
 * Public-links manager. A PublicExamLink mints a UUID token that anonymous
 * takers use at /public/exam/:token (verified: the public availability + start
 * flow and the /public/exam/:token page both exist). Create with an active
 * toggle + optional [start, end] window; activate/deactivate via PATCH; copy the
 * shareable URL.
 *
 * Results download two ways: the exam-wide export (all takers) elsewhere, and a
 * PER-LINK export here (only that link's anonymous takers, filename from its
 * tag) so sessions can be graded/differentiated separately. Existing links are
 * also editable (window / tag / start-code) via the reused bottom form.
 */
import type { AdminExamDetail, PublicLink } from "@codeapt/shared";
import { Copy, Download, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import type { ExamAuthoringApi } from "../../../lib/exam-authoring-api.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { FormField } from "../../ui/form-field.js";
import { IconButton } from "../../ui/icon-button.js";
import { Input } from "../../ui/input.js";
import { Switch } from "../../ui/switch.js";
import { useToast } from "../../ui/toast.js";

function publicUrl(token: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/public/exam/${token}`;
}

/** datetime-local ("YYYY-MM-DDTHH:mm") → ISO, or null when blank. */
function localToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → datetime-local ("YYYY-MM-DDTHH:mm") in the browser's zone, or "". */
function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function PublicLinksDialog({
  open,
  onOpenChange,
  examId,
  links,
  onChanged,
  authApi = api.adminExams,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  links: AdminExamDetail["publicLinks"];
  onChanged: () => void;
  /** Authoring backend — defaults to the platform admin api; the college editor
   * injects a slug-bound tenant adapter. */
  authApi?: ExamAuthoringApi;
}) {
  const { toast } = useToast();
  const [active, setActive] = useState(true);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [codeEnabled, setCodeEnabled] = useState(false);
  const [code, setCode] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Per-link overrides (create form / edit).
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [resultsVisible, setResultsVisible] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");

  // A code gate that's ON needs ≥4 chars (the server enforces this too).
  const codeValid = !codeEnabled || code.trim().length >= 4;

  const resetForm = (): void => {
    setEditingId(null);
    setStart("");
    setEnd("");
    setActive(true);
    setCodeEnabled(false);
    setCode("");
    setTag("");
    setShuffleQuestions(false);
    setShuffleOptions(false);
    setResultsVisible(true);
    setFormError("");
  };

  /** Load an existing link into the bottom form to edit it. */
  const startEdit = (link: PublicLink): void => {
    setEditingId(link.id);
    setFormError("");
    setActive(link.isActive);
    setStart(isoToLocal(link.startTime));
    setEnd(isoToLocal(link.endTime));
    setCodeEnabled(link.accessCodeEnabled);
    setCode(link.accessCode);
    setTag(link.tag);
    setShuffleQuestions(link.shuffleQuestions);
    setShuffleOptions(link.shuffleOptions);
    setResultsVisible(link.resultsVisible);
  };

  const submit = async (): Promise<void> => {
    setFormError("");
    setBusy(true);
    const body = {
      isActive: active,
      startTime: localToIso(start),
      endTime: localToIso(end),
      accessCodeEnabled: codeEnabled,
      accessCode: codeEnabled ? code.trim() : "",
      tag: tag.trim(),
      shuffleQuestions,
      shuffleOptions,
      resultsVisible,
    };
    try {
      if (editingId) {
        await authApi.updatePublicLink(editingId, body);
        toast({ variant: "success", title: "Public link updated" });
      } else {
        await authApi.createPublicLink(examId, body);
        toast({ variant: "success", title: "Public link created" });
      }
      resetForm();
      onChanged();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const downloadResults = async (link: PublicLink): Promise<void> => {
    setDownloadingId(link.id);
    try {
      const { blob, filename } = await authApi.exportPublicLinkResults(link.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setDownloadingId(null);
    }
  };

  const toggle = async (link: PublicLink): Promise<void> => {
    setBusyId(link.id);
    try {
      // Resend the window + code + per-link settings so PATCH doesn't clear them.
      await authApi.updatePublicLink(link.id, {
        isActive: !link.isActive,
        startTime: link.startTime,
        endTime: link.endTime,
        accessCodeEnabled: link.accessCodeEnabled,
        accessCode: link.accessCode,
        tag: link.tag,
        shuffleQuestions: link.shuffleQuestions,
        shuffleOptions: link.shuffleOptions,
        resultsVisible: link.resultsVisible,
      });
      toast({ title: link.isActive ? "Link deactivated" : "Link activated" });
      onChanged();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (link: PublicLink): Promise<void> => {
    setBusyId(link.id);
    try {
      await authApi.deletePublicLink(link.id);
      toast({ title: "Link revoked" });
      onChanged();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (token: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(publicUrl(token));
      toast({ title: "URL copied" });
    } catch {
      toast({ variant: "error", title: "Copy failed — select and copy manually" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Public links</DialogTitle>
          <DialogDescription>
            Share an exam with anonymous takers via a tokenized URL. Download
            each link&apos;s results on its own, or find every taker in the
            exam-wide export. Tag a link to tell sessions apart.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          {/* Existing links */}
          {links.length > 0 ? (
            <ul className="space-y-2">
              {links.map((link) => (
                <li
                  key={link.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-subtle bg-surface-base p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {link.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="neutral">Inactive</Badge>
                      )}
                      {link.tag ? (
                        <Badge variant="info">{link.tag}</Badge>
                      ) : null}
                      {link.shuffleQuestions || link.shuffleOptions ? (
                        <Badge variant="neutral">Shuffled</Badge>
                      ) : null}
                      {!link.resultsVisible ? (
                        <Badge variant="warning">Results hidden</Badge>
                      ) : null}
                      <code className="truncate font-mono text-xs text-ink-secondary">
                        /public/exam/{link.accessToken}
                      </code>
                    </div>
                    {link.startTime || link.endTime ? (
                      <p className="mt-1 text-xs text-ink-muted">
                        {link.startTime
                          ? new Date(link.startTime).toLocaleString()
                          : "—"}{" "}
                        →{" "}
                        {link.endTime
                          ? new Date(link.endTime).toLocaleString()
                          : "—"}
                      </p>
                    ) : null}
                    {link.accessCodeEnabled ? (
                      <p className="mt-1 text-xs text-ink-muted">
                        Start code:{" "}
                        <code className="font-mono text-ink-secondary">
                          {link.accessCode}
                        </code>{" "}
                        — read out to takers before they begin
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void copy(link.accessToken)}
                    >
                      <Copy className="h-4 w-4" /> Copy URL
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busyId === link.id}
                      onClick={() => void toggle(link)}
                    >
                      {link.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={downloadingId === link.id}
                      onClick={() => void downloadResults(link)}
                    >
                      <Download className="h-4 w-4" /> Results
                    </Button>
                    <IconButton
                      aria-label="Edit link"
                      variant="ghost"
                      size="sm"
                      icon={<Pencil className="h-4 w-4" />}
                      onClick={() => startEdit(link)}
                    />
                    <IconButton
                      aria-label="Revoke link"
                      variant="ghost"
                      size="sm"
                      disabled={busyId === link.id}
                      icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                      onClick={() => void revoke(link)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">
              No public links yet. Create one below.
            </p>
          )}

          {/* Create / edit */}
          <div className="space-y-4 rounded-xl border border-subtle bg-surface-base p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
              {editingId ? (
                <>
                  <Pencil className="h-4 w-4" /> Edit link
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4" /> New link
                </>
              )}
            </h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Opens at" hint="Optional. Blank = immediately.">
                <Input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </FormField>
              <FormField label="Closes at" hint="Optional. Blank = no end.">
                <Input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </FormField>
            </div>
            <FormField
              label="Tag"
              hint="Admin-only label to tell sessions apart (e.g. 'Section 2 CSE'). Never shown to takers; appears in the results file."
            >
              <Input
                value={tag}
                placeholder="e.g. Section 2 CSE AVNIT"
                onChange={(e) => setTag(e.target.value)}
                maxLength={120}
              />
            </FormField>

            {/* Per-link exam behavior (independent of other links). */}
            <div className="space-y-2 border-t border-subtle pt-3">
              <label className="flex items-center gap-2">
                <Switch
                  checked={shuffleQuestions}
                  onCheckedChange={setShuffleQuestions}
                />
                <span className="text-sm text-ink">
                  Shuffle questions{" "}
                  <span className="text-ink-muted">
                    — randomize order within each section (per taker)
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2">
                <Switch
                  checked={shuffleOptions}
                  onCheckedChange={setShuffleOptions}
                />
                <span className="text-sm text-ink">
                  Shuffle options{" "}
                  <span className="text-ink-muted">
                    — randomize each MCQ&apos;s option order (per taker)
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2">
                <Switch
                  checked={resultsVisible}
                  onCheckedChange={setResultsVisible}
                />
                <span className="text-sm text-ink">
                  Show results{" "}
                  <span className="text-ink-muted">
                    — display the score after submission; off shows &ldquo;coming
                    soon&rdquo;
                  </span>
                </span>
              </label>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <Switch checked={codeEnabled} onCheckedChange={setCodeEnabled} />
                <span className="text-sm text-ink">
                  Require a start code{" "}
                  <span className="text-ink-muted">
                    — takers enter this to begin; read it out right before the exam
                  </span>
                </span>
              </label>
              {codeEnabled ? (
                <FormField
                  label="Start code"
                  hint="At least 4 characters. Case-insensitive."
                >
                  <Input
                    value={code}
                    placeholder="e.g. TIGER24"
                    onChange={(e) => setCode(e.target.value)}
                    maxLength={64}
                  />
                </FormField>
              ) : null}
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2">
                <Switch checked={active} onCheckedChange={setActive} />
                <span className="text-sm text-ink">
                  {editingId ? "Active" : "Active immediately"}
                </span>
              </label>
              <div className="flex items-center gap-2">
                {editingId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={resetForm}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  loading={busy}
                  disabled={!codeValid}
                  onClick={() => void submit()}
                >
                  {editingId ? (
                    "Save changes"
                  ) : (
                    <>
                      <Plus className="h-4 w-4" /> Create link
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
