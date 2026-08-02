/**
 * Public-links manager. A PublicExamLink mints a UUID token that anonymous
 * takers use at /public/exam/:token (verified: the public availability + start
 * flow and the /public/exam/:token page both exist). Create with an active
 * toggle + optional [start, end] window; activate/deactivate via PATCH; copy the
 * shareable URL.
 *
 * NOTE: results are exported PER-EXAM (which already includes public-link
 * takers), not per-link — there is no per-link results endpoint in the backend.
 */
import type { AdminExamDetail, PublicLink } from "@codeapt/shared";
import { Copy, Link2, Plus, Trash2 } from "lucide-react";
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
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");

  const create = async (): Promise<void> => {
    setFormError("");
    setBusy(true);
    try {
      await authApi.createPublicLink(examId, {
        isActive: active,
        startTime: localToIso(start),
        endTime: localToIso(end),
      });
      setStart("");
      setEnd("");
      setActive(true);
      toast({ variant: "success", title: "Public link created" });
      onChanged();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (link: PublicLink): Promise<void> => {
    setBusyId(link.id);
    try {
      // Resend the window so PATCH doesn't clear it.
      await authApi.updatePublicLink(link.id, {
        isActive: !link.isActive,
        startTime: link.startTime,
        endTime: link.endTime,
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
            Share an exam with anonymous takers via a tokenized URL. Results for
            these takers appear in the exam-wide results export.
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

          {/* Create */}
          <div className="space-y-4 rounded-xl border border-subtle bg-surface-base p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Link2 className="h-4 w-4" /> New link
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
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2">
                <Switch checked={active} onCheckedChange={setActive} />
                <span className="text-sm text-ink">Active immediately</span>
              </label>
              <Button
                type="button"
                size="sm"
                loading={busy}
                onClick={() => void create()}
              >
                <Plus className="h-4 w-4" /> Create link
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
