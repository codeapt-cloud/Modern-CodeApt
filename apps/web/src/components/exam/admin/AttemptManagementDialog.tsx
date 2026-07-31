/**
 * Attempt management (item C4) — the read subsystem around the working per-user
 * reset. Shows the exam's attempt counters, drills into one user's attempts,
 * lists the immutable reset-audit log, and resets attempts via a real USER
 * PICKER (search + pick — replacing the earlier userId-paste stopgap). The reset
 * still calls the same audited endpoint and the log refreshes to show the entry.
 */
import type {
  AdminExamAttemptCounter,
  AdminUserListItem,
} from "@codeapt/shared";
import { RotateCcw, Search, X } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";
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
import { Skeleton } from "../../ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table.js";
import { Textarea } from "../../ui/textarea.js";
import { useToast } from "../../ui/toast.js";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/** Search + pick a user (reuses the 4-i user search). */
function UserPicker({
  picked,
  onPick,
  onClear,
}: {
  picked: { id: string; name: string } | null;
  onPick: (u: { id: string; name: string }) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const { data } = useQuery(
    () =>
      q.trim().length >= 2
        ? api.adminUsers.list({ q: q.trim(), pageSize: 6 })
        : Promise.resolve(null),
    [q],
  );
  const matches = data?.items ?? [];

  if (picked) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="primary" className="gap-1">
          {picked.name}
          <IconButton
            aria-label="Clear selected user"
            variant="ghost"
            size="sm"
            className="h-4 w-4"
            icon={<X className="h-3 w-3" />}
            onClick={onClear}
          />
        </Badge>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <Input
          className="pl-9"
          placeholder="Search a user by name, email, roll…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {q.trim().length >= 2 && matches.length > 0 ? (
        <ul className="max-h-40 divide-y divide-subtle overflow-y-auto rounded-xl border border-subtle">
          {matches.map((u: AdminUserListItem) => (
            <li key={u.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-overlay"
                onClick={() =>
                  onPick({ id: u.id, name: u.fullName || u.username })
                }
              >
                <span className="text-ink">{u.fullName || u.username}</span>
                <span className="text-xs text-ink-muted">
                  {u.collegeName || u.email}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim().length >= 2 ? (
        <p className="text-xs text-ink-muted">No users match “{q}”.</p>
      ) : null}
    </div>
  );
}

export function AttemptManagementDialog({
  open,
  onOpenChange,
  examId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
}) {
  const { toast } = useToast();
  const counters = useQuery(() => api.adminExams.attemptCounters(examId), [examId]);
  const log = useQuery(() => api.adminExams.resetLog(examId), [examId]);

  const [viewing, setViewing] = useState<{ userId: string } | null>(null);
  const attempts = useQuery(
    () =>
      viewing
        ? api.adminExams.userAttempts(examId, viewing.userId)
        : Promise.resolve(null),
    [viewing?.userId],
  );

  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const submitReset = async (): Promise<void> => {
    if (!picked) return;
    setFormError("");
    setSubmitting(true);
    try {
      await api.adminExams.resetAttempts(examId, {
        userId: picked.id,
        reason: reason.trim(),
      });
      toast({ variant: "success", title: "Attempts reset (audited)" });
      setPicked(null);
      setReason("");
      counters.refetch();
      log.refetch();
      if (viewing) attempts.refetch();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const counterItems = counters.data?.items ?? [];
  const logItems = log.data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attempt management</DialogTitle>
          <DialogDescription>
            Attempt usage, per-user attempts, and the immutable reset-audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* --- Reset via user picker --- */}
          <section className="space-y-3 rounded-xl border border-subtle p-4">
            <h3 className="text-sm font-semibold text-ink">Reset attempts</h3>
            {formError ? <Alert variant="error">{formError}</Alert> : null}
            <FormField label="User">
              <UserPicker
                picked={picked}
                onPick={setPicked}
                onClear={() => setPicked(null)}
              />
            </FormField>
            <FormField label="Reason" hint="Recorded in the audit log.">
              <Textarea
                rows={2}
                value={reason}
                placeholder="e.g. support request — proctoring glitch"
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
            <Button
              type="button"
              variant="destructive"
              loading={submitting}
              disabled={!picked}
              onClick={() => void submitReset()}
            >
              <RotateCcw className="h-4 w-4" /> Reset attempts
            </Button>
          </section>

          {/* --- Attempt counters --- */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Attempt counters</h3>
            {counters.loading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : counterItems.length === 0 ? (
              <p className="text-xs text-ink-muted">
                No attempt counters yet for this exam.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Roll</TableHead>
                    <TableHead>Used</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {counterItems.map((c: AdminExamAttemptCounter) => (
                    <TableRow key={c.userId}>
                      <TableCell className="text-ink">{c.student}</TableCell>
                      <TableCell className="font-mono text-xs text-ink-secondary">
                        {c.rollNumber || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.exhausted ? "warning" : "neutral"}>
                          {c.attemptCount} / {c.maxAttempts}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewing({ userId: c.userId })}
                        >
                          View attempts
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {/* --- Drilled-in user attempts --- */}
          {viewing ? (
            <section className="space-y-2 rounded-xl border border-subtle p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink">
                  {attempts.data ? attempts.data.student : "User"} — attempts
                </h3>
                <IconButton
                  aria-label="Close attempts"
                  variant="ghost"
                  size="sm"
                  icon={<X className="h-4 w-4" />}
                  onClick={() => setViewing(null)}
                />
              </div>
              {attempts.loading ? (
                <Skeleton className="h-20 w-full rounded-xl" />
              ) : attempts.data && attempts.data.attempts.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Warnings</TableHead>
                      <TableHead>Started</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attempts.data.attempts.map((a) => (
                      <TableRow key={a.attemptId}>
                        <TableCell className="text-ink-secondary">
                          {a.status}
                        </TableCell>
                        <TableCell className="text-ink-secondary">
                          {a.score}
                        </TableCell>
                        <TableCell>
                          <Badge variant={a.passed ? "success" : "neutral"}>
                            {a.passed ? "PASS" : "—"}
                          </Badge>
                          {a.isMalpractice ? (
                            <Badge variant="warning">malpractice</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-ink-secondary">
                          {a.warnings}
                        </TableCell>
                        <TableCell className="text-ink-secondary">
                          {fmtDate(a.startedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-xs text-ink-muted">
                  No attempt rows (the counter may exist without stored attempts).
                </p>
              )}
            </section>
          ) : null}

          {/* --- Reset audit log --- */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Reset audit log</h3>
            {log.loading ? (
              <Skeleton className="h-20 w-full rounded-xl" />
            ) : logItems.length === 0 ? (
              <p className="text-xs text-ink-muted">No resets recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Reset by</TableHead>
                    <TableHead>Prev</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logItems.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-ink">{l.student}</TableCell>
                      <TableCell className="text-ink-secondary">
                        {l.resetBy}
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {l.previousCount}
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {l.reason || "—"}
                      </TableCell>
                      <TableCell className="text-ink-secondary">
                        {fmtDate(l.resetAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
