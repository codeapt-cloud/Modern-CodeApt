/**
 * Quiz Question/Choice sub-editor for a quiz-type topic. One dialog that toggles
 * between a question LIST and an inline FORM (no nested dialogs). A question is
 * always MCQ: the form enforces the same rules the backend does — ≥2 choices and
 * ≥1 correct — surfaced inline before submit; server errors surface too.
 */
import type {
  AdminQuizQuestion,
  AdminQuizQuestionUpsert,
} from "@codeapt/shared";
import { ArrowLeft, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
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
import { EmptyState } from "../../ui/empty-state.js";
import { FormField } from "../../ui/form-field.js";
import { IconButton } from "../../ui/icon-button.js";
import { Input } from "../../ui/input.js";
import { Skeleton } from "../../ui/skeleton.js";
import { useToast } from "../../ui/toast.js";
import { useQuery } from "../../../lib/use-query.js";

interface ChoiceDraft {
  text: string;
  isCorrect: boolean;
}
interface QuestionDraft {
  text: string;
  marks: number;
  choices: ChoiceDraft[];
}

function toDraft(q: AdminQuizQuestion | null): QuestionDraft {
  if (!q) {
    return {
      text: "",
      marks: 1,
      choices: [
        { text: "", isCorrect: false },
        { text: "", isCorrect: false },
      ],
    };
  }
  return {
    text: q.text,
    marks: q.marks,
    choices: q.choices.map((c) => ({ text: c.text, isCorrect: c.isCorrect })),
  };
}

/** Client-side mirror of the backend rules; returns a message or "". */
function validate(d: QuestionDraft): string {
  if (d.text.trim() === "") return "Question text is required.";
  const filled = d.choices.filter((c) => c.text.trim() !== "");
  if (filled.length < 2) return "Add at least 2 choices.";
  if (!filled.some((c) => c.isCorrect))
    return "Mark at least one choice correct.";
  return "";
}

export interface QuizQuestionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topicId: string;
  topicName: string;
  /** Called after any create/update/delete so the caller can refresh counts. */
  onChanged: () => void;
}

export function QuizQuestionsDialog({
  open,
  onOpenChange,
  topicId,
  topicName,
  onChanged,
}: QuizQuestionsDialogProps) {
  const { toast } = useToast();
  const { data, loading, error, refetch } = useQuery(
    () => api.adminCurriculum.questions.list(topicId),
    [topicId],
  );
  const questions = data?.items ?? [];

  const [mode, setMode] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<AdminQuizQuestion | null>(null);
  const [draft, setDraft] = useState<QuestionDraft>(() => toDraft(null));
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const openCreate = (): void => {
    setEditing(null);
    setDraft(toDraft(null));
    setFormError("");
    setMode("form");
  };
  const openEdit = (q: AdminQuizQuestion): void => {
    setEditing(q);
    setDraft(toDraft(q));
    setFormError("");
    setMode("form");
  };

  const patch = (next: Partial<QuestionDraft>): void =>
    setDraft((d) => ({ ...d, ...next }));
  const setChoice = (i: number, next: Partial<ChoiceDraft>): void =>
    setDraft((d) => {
      const choices = d.choices.map((c, j) => (j === i ? { ...c, ...next } : c));
      return { ...d, choices };
    });
  const addChoice = (): void =>
    setDraft((d) => ({ ...d, choices: [...d.choices, { text: "", isCorrect: false }] }));
  const removeChoice = (i: number): void =>
    setDraft((d) =>
      d.choices.length <= 2
        ? d
        : { ...d, choices: d.choices.filter((_, j) => j !== i) },
    );

  const submit = async (): Promise<void> => {
    const msg = validate(draft);
    if (msg) {
      setFormError(msg);
      return;
    }
    setBusy(true);
    setFormError("");
    const payload: AdminQuizQuestionUpsert = {
      text: draft.text.trim(),
      marks: Math.max(0, Math.trunc(draft.marks) || 0),
      choices: draft.choices
        .filter((c) => c.text.trim() !== "")
        .map((c) => ({ text: c.text.trim(), isCorrect: c.isCorrect })),
    };
    try {
      if (editing) {
        await api.adminCurriculum.questions.update(editing.id, payload);
      } else {
        await api.adminCurriculum.questions.create(topicId, payload);
      }
      toast({ variant: "success", title: editing ? "Question updated" : "Question added" });
      setMode("list");
      refetch();
      onChanged();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (q: AdminQuizQuestion): Promise<void> => {
    setBusy(true);
    try {
      await api.adminCurriculum.questions.remove(q.id);
      toast({ title: "Question deleted" });
      refetch();
      onChanged();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "form"
              ? editing
                ? "Edit question"
                : "New question"
              : `Quiz — ${topicName}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "form"
              ? "Each question needs at least 2 choices and at least 1 correct."
              : "Author the multiple-choice questions for this quiz topic."}
          </DialogDescription>
        </DialogHeader>

        {mode === "list" ? (
          <div className="space-y-4">
            {loading ? (
              <Skeleton className="h-32 w-full rounded-xl" />
            ) : error ? (
              <Alert variant="error">{error}</Alert>
            ) : questions.length === 0 ? (
              <EmptyState
                title="No questions yet"
                description="Add the first question to this quiz."
                icon={<CheckCircle2 />}
                action={
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4" /> New question
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-3">
                {questions.map((q, i) => (
                  <li
                    key={q.id}
                    className="rounded-xl border border-subtle bg-surface-base p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-ink-muted">
                            Q{i + 1}
                          </span>
                          <Badge variant="neutral">{q.marks} marks</Badge>
                        </div>
                        <p className="text-sm text-ink">{q.text}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(q)}>
                          Edit
                        </Button>
                        <IconButton
                          aria-label="Delete question"
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                          onClick={() => void remove(q)}
                        />
                      </div>
                    </div>
                    <ul className="mt-2 grid gap-1">
                      {q.choices.map((c) => (
                        <li
                          key={c.id}
                          className={
                            "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm " +
                            (c.isCorrect
                              ? "border-success/40 bg-success-subtle text-ink"
                              : "border-subtle text-ink-secondary")
                          }
                        >
                          <span className="flex-1">{c.text}</span>
                          {c.isCorrect ? (
                            <CheckCircle2 className="h-4 w-4 text-success-fg" />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {questions.length > 0 ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" /> New question
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {formError ? <Alert variant="error">{formError}</Alert> : null}

            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <FormField label="Question text" required>
                <Input
                  value={draft.text}
                  onChange={(e) => patch({ text: e.target.value })}
                />
              </FormField>
              <FormField label="Marks">
                <Input
                  type="number"
                  min={0}
                  value={String(draft.marks)}
                  onChange={(e) =>
                    patch({ marks: Math.trunc(Number(e.target.value)) || 0 })
                  }
                />
              </FormField>
            </div>

            <FormField
              label="Choices"
              hint="Tick every correct choice. At least 2 choices, at least 1 correct."
            >
              <div className="grid gap-2">
                {draft.choices.map((c, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Checkbox
                      checked={c.isCorrect}
                      onCheckedChange={(v) => setChoice(i, { isCorrect: v === true })}
                      aria-label={`Mark choice ${i + 1} correct`}
                    />
                    <Input
                      value={c.text}
                      placeholder={`Choice ${i + 1}`}
                      onChange={(e) => setChoice(i, { text: e.target.value })}
                    />
                    <IconButton
                      aria-label={`Remove choice ${i + 1}`}
                      variant="ghost"
                      size="sm"
                      disabled={draft.choices.length <= 2}
                      icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                      onClick={() => removeChoice(i)}
                    />
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={addChoice}
              >
                <Plus className="h-4 w-4" /> Add choice
              </Button>
            </FormField>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setMode("list")}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button loading={busy} onClick={() => void submit()}>
                {editing ? "Save question" : "Add question"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
