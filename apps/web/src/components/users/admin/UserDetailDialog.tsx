/**
 * User detail (item 4-i read view + CRUD-batch-2 CONFIG actions). Shows profile,
 * a stats grid, and enrollment / attempt tables, plus admin actions:
 * activate/deactivate, role change, profile edit, and unenroll. Consequential
 * actions (deactivate, role change, unenroll) confirm first; the server enforces
 * the self-protection + last-admin guards and surfaces them as errors.
 *
 * passwordHash / tokenVersion are never shown or edited here — password resets
 * go through the existing force-password-change flow.
 */
import { Role, type AdminUpdateProfile, type AdminUserDetail } from "@codeapt/shared";
import type { ReactNode } from "react";
import { useState } from "react";

import { useAuth } from "../../../providers/AuthProvider.js";
import { api, parseApiError } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
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
import { IconButton } from "../../ui/icon-button.js";
import { Input } from "../../ui/input.js";
import { Skeleton } from "../../ui/skeleton.js";
import { Textarea } from "../../ui/textarea.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table.js";
import { useToast } from "../../ui/toast.js";
import { Trash2 } from "lucide-react";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface-base p-3">
      <p className="font-mono text-lg font-bold text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}

function toDraft(d: AdminUserDetail): AdminUpdateProfile {
  return {
    fullName: d.profile.fullName,
    collegeName: d.profile.collegeName,
    rollNumber: d.profile.rollNumber,
    phoneNumber: d.profile.phoneNumber,
    state: d.profile.state,
    bio: d.profile.bio,
  };
}

interface Confirm {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  run: () => Promise<unknown>;
}

export interface UserDetailDialogProps {
  userId: string;
  onOpenChange: (open: boolean) => void;
  /** Refetch the underlying list after a mutation. */
  onChanged?: () => void;
}

export function UserDetailDialog({
  userId,
  onOpenChange,
  onChanged,
}: UserDetailDialogProps) {
  const { toast } = useToast();
  const { user: me } = useAuth();
  const { data, loading, error, refetch } = useQuery<AdminUserDetail>(
    () => api.adminUsers.get(userId),
    [userId],
  );

  const [busy, setBusy] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [draft, setDraft] = useState<AdminUpdateProfile | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const run = async (
    fn: () => Promise<unknown>,
    successTitle: string,
  ): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      toast({ variant: "success", title: successTitle });
      refetch();
      onChanged?.();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const isSelf = data?.id === me?.id;

  const startEditProfile = (): void => {
    if (!data) return;
    setDraft(toDraft(data));
    setEditingProfile(true);
  };

  const saveProfile = async (): Promise<void> => {
    if (!draft) return;
    await run(
      () => api.adminUsers.updateProfile(userId, draft),
      "Profile updated",
    );
    setEditingProfile(false);
  };

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {data ? data.profile.fullName || data.username : "User"}
            </DialogTitle>
            <DialogDescription>
              {data
                ? `${data.email} · ${data.profile.collegeName || "No college"}`
                : "Loading user…"}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <Skeleton className="h-72 w-full rounded-2xl" />
          ) : error ? (
            <Alert variant="error">{error}</Alert>
          ) : data ? (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant={data.role === Role.ADMIN ? "primary" : "neutral"}>
                  {data.role}
                </Badge>
                <Badge variant={data.isActive ? "success" : "warning"}>
                  {data.isActive ? "Active" : "Inactive"}
                </Badge>
                <Badge variant="neutral">Roll {data.profile.rollNumber || "—"}</Badge>
                {data.profile.state ? (
                  <Badge variant="neutral">{data.profile.state}</Badge>
                ) : null}
                <Badge variant="neutral">Joined {fmtDate(data.createdAt)}</Badge>
              </div>

              {/* --- Admin actions --- */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-subtle bg-surface-base p-3">
                <span className="mr-1 text-xs font-medium text-ink-muted">
                  Actions
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (data.isActive) {
                      setConfirm({
                        title: "Deactivate this user?",
                        body: "They will be locked out on their next request (login and existing sessions stop working).",
                        confirmLabel: "Deactivate",
                        run: () => api.adminUsers.setActive(userId, false),
                      });
                    } else {
                      void run(
                        () => api.adminUsers.setActive(userId, true),
                        "User activated",
                      );
                    }
                  }}
                >
                  {data.isActive ? "Deactivate" : "Activate"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    const next =
                      data.role === Role.ADMIN ? Role.STUDENT : Role.ADMIN;
                    setConfirm({
                      title:
                        next === Role.ADMIN
                          ? "Make this user an admin?"
                          : "Make this user a student?",
                      body:
                        next === Role.ADMIN
                          ? "They will gain full admin access."
                          : "They will lose admin access.",
                      confirmLabel: "Change role",
                      run: () => api.adminUsers.setRole(userId, next),
                    });
                  }}
                >
                  {data.role === Role.ADMIN ? "Make student" : "Make admin"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || editingProfile}
                  onClick={startEditProfile}
                >
                  Edit profile
                </Button>
                {isSelf ? (
                  <span className="text-xs text-ink-muted">
                    (this is you — self-deactivate / self-demote are blocked)
                  </span>
                ) : null}
              </div>

              {/* --- Profile edit form --- */}
              {editingProfile && draft ? (
                <div className="space-y-3 rounded-xl border border-subtle p-4">
                  <h3 className="text-sm font-semibold text-ink">Edit profile</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Full name" required>
                      <Input
                        value={draft.fullName}
                        onChange={(e) =>
                          setDraft({ ...draft, fullName: e.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="Roll number" required>
                      <Input
                        value={draft.rollNumber}
                        onChange={(e) =>
                          setDraft({ ...draft, rollNumber: e.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="College">
                      <Input
                        value={draft.collegeName}
                        onChange={(e) =>
                          setDraft({ ...draft, collegeName: e.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="Phone">
                      <Input
                        value={draft.phoneNumber}
                        onChange={(e) =>
                          setDraft({ ...draft, phoneNumber: e.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="State">
                      <Input
                        value={draft.state}
                        onChange={(e) =>
                          setDraft({ ...draft, state: e.target.value })
                        }
                      />
                    </FormField>
                  </div>
                  <FormField label="Bio">
                    <Textarea
                      rows={2}
                      value={draft.bio}
                      onChange={(e) =>
                        setDraft({ ...draft, bio: e.target.value })
                      }
                    />
                  </FormField>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingProfile(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      loading={busy}
                      disabled={draft.fullName.trim() === "" || draft.rollNumber.trim() === ""}
                      onClick={() => void saveProfile()}
                    >
                      Save profile
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Enrollments" value={data.stats.enrollments} />
                <Stat label="Exams taken" value={data.stats.examAttempts} />
                <Stat label="Exams passed" value={data.stats.examsPassed} />
                <Stat label="Essays" value={data.stats.essayAttempts} />
                <Stat label="Topics done" value={data.stats.topicsCompleted} />
                <Stat label="Quizzes" value={data.stats.quizSubmissions} />
                <Stat label="Daily streak" value={data.stats.currentStreak} />
                <Stat label="Daily score" value={data.stats.dailyTotalScore} />
              </div>

              <Section title="Enrollments">
                {data.enrollments.length === 0 ? (
                  <Empty>No enrollments.</Empty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Enrolled</TableHead>
                        <TableHead className="text-right">Unenroll</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.enrollments.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="text-ink">{e.subject}</TableCell>
                          <TableCell className="text-ink-secondary">
                            {e.source}
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {fmtDate(e.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <IconButton
                              aria-label={`Unenroll from ${e.subject}`}
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                              onClick={() =>
                                setConfirm({
                                  title: "Unenroll from this subject?",
                                  body: (
                                    <>
                                      Removes access to “{e.subject}”. Their
                                      progress and attempt history are preserved
                                      (re-enrolling restores them).
                                    </>
                                  ),
                                  confirmLabel: "Unenroll",
                                  run: () => api.adminUsers.unenroll(userId, e.id),
                                })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>

              <Section title="Exam attempts">
                {data.examAttempts.length === 0 ? (
                  <Empty>No exam attempts.</Empty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Exam</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Completed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.examAttempts.map((a, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-ink">{a.exam}</TableCell>
                          <TableCell className="text-ink-secondary">
                            {a.score}/{a.totalMarks}
                          </TableCell>
                          <TableCell>
                            <Badge variant={a.passed ? "success" : "warning"}>
                              {a.passed ? "PASS" : "FAIL"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {a.status}
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {fmtDate(a.completedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>

              <Section title="Essay attempts">
                {data.essayAttempts.length === 0 ? (
                  <Empty>No essay attempts.</Empty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Prompt</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Submitted</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.essayAttempts.map((a, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-ink">{a.topic}</TableCell>
                          <TableCell className="text-ink-secondary">
                            {a.finalScore}
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {a.status}
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {fmtDate(a.submittedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>

              <Section title="Quiz submissions">
                {data.quizSubmissions.length === 0 ? (
                  <Empty>No quiz submissions.</Empty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead>Topic</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>%</TableHead>
                        <TableHead>Submitted</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.quizSubmissions.map((s, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-ink">{s.subject}</TableCell>
                          <TableCell className="text-ink-secondary">
                            {s.topic ?? "—"}
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {s.score}/{s.totalQuestions}
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {s.percentage}%
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {fmtDate(s.submittedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>

              <Section title="Daily submissions">
                {data.dailySubmissions.length === 0 ? (
                  <Empty>No daily-challenge submissions.</Empty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Question</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Submitted</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.dailySubmissions.map((s, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-ink">
                            {s.question}
                          </TableCell>
                          <TableCell>
                            <Badge variant={s.isCorrect ? "success" : "warning"}>
                              {s.isCorrect ? "Correct" : "Incorrect"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {s.score}
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {fmtDate(s.submittedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>

              <Section title="Topic progress">
                {data.topicProgress.length === 0 ? (
                  <Empty>No topic progress recorded.</Empty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Topic</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Completed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topicProgress.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-ink">{p.topic}</TableCell>
                          <TableCell>
                            <Badge
                              variant={p.isCompleted ? "success" : "neutral"}
                            >
                              {p.isCompleted ? "Completed" : "In progress"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-ink-secondary">
                            {fmtDate(p.completedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Consequential-action confirm (rendered as a sibling dialog). */}
      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                if (c) void run(c.run, `${c.confirmLabel} — done`);
              }}
            >
              {confirm?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-muted">{children}</p>;
}
