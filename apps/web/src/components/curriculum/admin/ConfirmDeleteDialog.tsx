/**
 * Reusable destructive-delete confirm that understands the backend's
 * DELETE_BLOCKED (409) contract. On a clean delete it behaves like a normal
 * confirm dialog; when the server refuses because dependents exist, it does NOT
 * dump a generic error toast — it stays open and shows exactly what's blocking
 * (named counts from `error.details.blockers`) plus what the admin should do.
 *
 * Shared by the program / subject / module delete flows.
 */
import { useEffect, useState, type ReactNode } from "react";

import { parseApiError } from "../../../lib/api-client.js";
import {
  blockerGuidance,
  blockerLine,
  blockersFromError,
  type Blockers,
} from "../../../lib/curriculum-admin-ui.js";
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

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Header, e.g. "Delete this course?". */
  title: string;
  /** Normal (pre-confirm) explanation of the destructive action. */
  description: ReactNode;
  /** Noun used in the blocked message, e.g. "course", "program", "module". */
  noun: string;
  /** Performs the delete; must throw on failure so 409s can be inspected. */
  onConfirm: () => Promise<unknown>;
  /** Called after a clean delete (caller closes + toasts + refetches). */
  onDeleted: () => void;
  confirmLabel?: string;
  /** Extra actionable guidance shown only in the BLOCKED state (e.g. "Deactivate instead"). */
  blockedHint?: ReactNode;
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  noun,
  onConfirm,
  onDeleted,
  confirmLabel = "Delete",
  blockedHint,
}: ConfirmDeleteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<Blockers | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Fresh state each time the dialog opens for a new target.
  useEffect(() => {
    if (open) {
      setBusy(false);
      setBlockers(null);
      setErrorMsg("");
    }
  }, [open]);

  const handleConfirm = async (): Promise<void> => {
    setBusy(true);
    setErrorMsg("");
    try {
      await onConfirm();
      onDeleted();
      onOpenChange(false);
    } catch (err) {
      const parsed = parseApiError(err);
      const blocked = blockersFromError(parsed);
      if (blocked) {
        setBlockers(blocked);
      } else {
        setErrorMsg(parsed.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {blockers ? `Can't delete this ${noun} yet` : title}
          </DialogTitle>
          {!blockers ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        {blockers ? (
          <Alert
            variant="warning"
            title={`This ${noun} still has dependents:`}
          >
            <ul className="my-1 list-disc space-y-0.5 pl-5">
              {Object.entries(blockers).map(([name, count]) => (
                <li key={name}>{blockerLine(name, count)}</li>
              ))}
            </ul>
            <p className="mt-1">{blockerGuidance(blockers)}</p>
            {blockedHint ? <p className="mt-1">{blockedHint}</p> : null}
          </Alert>
        ) : errorMsg ? (
          <Alert variant="error">{errorMsg}</Alert>
        ) : null}

        <DialogFooter>
          {blockers ? (
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                loading={busy}
                onClick={() => void handleConfirm()}
              >
                {confirmLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
