/**
 * Daily-challenge create/edit dialog. Covers the DailyQuestion fields with a
 * type switch: MCQ carries an option list + a correct-answer picker; CODE
 * carries a starter, language, and a test-case editor (input / expected /
 * hidden). `releaseDate` is a native date input — the API normalizes it to the
 * IST-day slot the serving query matches (one challenge per day).
 *
 * On edit the full detail (including test cases) is fetched by id, since the
 * list row is a lightweight summary.
 */
import {
  CODE_LANGUAGE_LABELS,
  CodeLanguage,
  DailyQuestionType,
  type AdminChallenge,
  type AdminChallengeTestCase,
  type AdminChallengeUpsert,
  type CodeLanguage as CodeLanguageT,
  type DailyQuestionType as DailyQuestionTypeT,
} from "@codeapt/shared";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
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
import { IconButton } from "../../ui/icon-button.js";
import { Input } from "../../ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { Skeleton } from "../../ui/skeleton.js";
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";
import { useToast } from "../../ui/toast.js";
import { useQuery } from "../../../lib/use-query.js";

interface ChallengeDraft {
  questionType: DailyQuestionTypeT;
  releaseDate: string;
  title: string;
  description: string;
  marks: number;
  options: string[];
  correctOption: number;
  starterCode: string;
  language: CodeLanguageT;
  testCases: AdminChallengeTestCase[];
}

function toDraft(c: AdminChallenge | null): ChallengeDraft {
  return {
    questionType: (c?.questionType ?? DailyQuestionType.MCQ) as DailyQuestionTypeT,
    releaseDate: c?.releaseDate ?? "",
    title: c?.title ?? "",
    description: c?.description ?? "",
    marks: c?.marks ?? 5,
    options: c?.options?.length ? c.options : ["", ""],
    correctOption: c?.correctOption ?? 0,
    starterCode: c?.starterCode ?? "",
    language: (c?.language ?? CodeLanguage.PYTHON) as CodeLanguageT,
    testCases: c?.testCases ?? [],
  };
}

export interface ChallengeEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; an id → edit (detail is fetched). */
  editingId: string | null;
  onSaved: () => void;
}

export function ChallengeEditorDialog({
  open,
  onOpenChange,
  editingId,
  onSaved,
}: ChallengeEditorDialogProps) {
  const { toast } = useToast();
  const isEdit = editingId !== null;

  const { data: detail } = useQuery(
    () => (editingId ? api.adminChallenges.get(editingId) : Promise.resolve(null)),
    [editingId],
  );

  const [draft, setDraft] = useState<ChallengeDraft>(() => toDraft(null));
  const [ready, setReady] = useState(!isEdit);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [aiBuilding, setAiBuilding] = useState(false);
  // Set once AI pre-fills the form → show the "review before saving" note.
  const [aiDrafted, setAiDrafted] = useState(false);

  // Populate the draft once detail arrives (create starts ready immediately).
  useEffect(() => {
    if (!isEdit) return;
    if (detail) {
      setDraft(toDraft(detail));
      setReady(true);
    }
  }, [detail, isEdit]);

  const patch = (next: Partial<ChallengeDraft>): void =>
    setDraft((d) => ({ ...d, ...next }));

  // "Build with AI": draft a CODE challenge and pre-fill the form. NOT
  // execution-validated here — the admin reviews + verifies before saving (the
  // automatic daily pipeline is the validated path).
  const aiBuild = async (): Promise<void> => {
    setFormError("");
    setAiBuilding(true);
    try {
      // Ask for the type the editor is currently set to (MCQ or CODE).
      const res = await api.adminChallenges.aiBuild(
        aiTopic.trim() || undefined,
        draft.questionType,
      );
      if (!res.configured) {
        toast({
          variant: "error",
          title: "AI isn't configured",
          description: "Set up an AI provider under Admin → AI providers first.",
        });
        return;
      }
      if (!res.draft) {
        toast({
          variant: "error",
          title: "Couldn't generate a challenge — try again.",
        });
        return;
      }
      const d = res.draft;
      if (d.questionType === DailyQuestionType.MCQ) {
        patch({
          questionType: DailyQuestionType.MCQ,
          title: d.title,
          description: d.description,
          options: d.options.length ? d.options : ["", ""],
          correctOption: d.correctOption,
        });
      } else {
        patch({
          questionType: DailyQuestionType.CODE,
          title: d.title,
          description: d.description,
          starterCode: d.starterCode,
          language: d.language,
          testCases: d.testCases,
        });
      }
      setAiDrafted(true);
      toast({
        variant: "success",
        title: "Draft ready",
        description:
          d.questionType === DailyQuestionType.MCQ
            ? "Review the question and confirm the correct option, then save."
            : "Review the prompt and test cases, then save.",
      });
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setAiBuilding(false);
    }
  };

  const isMcq = draft.questionType === DailyQuestionType.MCQ;

  const setOption = (i: number, value: string): void =>
    patch({ options: draft.options.map((o, idx) => (idx === i ? value : o)) });
  const addOption = (): void => patch({ options: [...draft.options, ""] });
  const removeOption = (i: number): void => {
    const options = draft.options.filter((_, idx) => idx !== i);
    const correctOption =
      draft.correctOption >= options.length
        ? Math.max(0, options.length - 1)
        : draft.correctOption;
    patch({ options, correctOption });
  };

  const addCase = (): void =>
    patch({
      testCases: [
        ...draft.testCases,
        { input: "", expectedOutput: "", isHidden: false },
      ],
    });
  const setCase = (i: number, next: Partial<AdminChallengeTestCase>): void =>
    patch({
      testCases: draft.testCases.map((c, idx) =>
        idx === i ? { ...c, ...next } : c,
      ),
    });
  const removeCase = (i: number): void =>
    patch({ testCases: draft.testCases.filter((_, idx) => idx !== i) });

  const submit = async (): Promise<void> => {
    setFormError("");
    setSubmitting(true);
    const payload: AdminChallengeUpsert = {
      questionType: draft.questionType,
      releaseDate: draft.releaseDate,
      title: draft.title.trim(),
      description: draft.description,
      marks: Math.max(0, Math.trunc(draft.marks) || 0),
      options: isMcq
        ? draft.options.map((o) => o.trim()).filter((o) => o.length > 0)
        : [],
      correctOption: draft.correctOption,
      starterCode: isMcq ? "" : draft.starterCode,
      language: draft.language,
      testCases: isMcq ? [] : draft.testCases,
    };
    try {
      if (isEdit) {
        await api.adminChallenges.update(editingId, payload);
      } else {
        await api.adminChallenges.create(payload);
      }
      toast({
        variant: "success",
        title: isEdit ? "Challenge updated" : "Challenge scheduled",
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const canSave =
    draft.title.trim() !== "" && draft.releaseDate !== "" && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit challenge" : "Schedule a challenge"}
          </DialogTitle>
          <DialogDescription>
            One challenge per day — the release date is its schedule slot.
          </DialogDescription>
        </DialogHeader>

        {isEdit && !ready ? (
          <Skeleton className="h-72 w-full rounded-2xl" />
        ) : (
          <div className="space-y-4">
            {formError ? <Alert variant="error">{formError}</Alert> : null}

            {/* Build with AI — drafts a CODE challenge to pre-fill the form. */}
            <div className="rounded-xl border border-dashed border-subtle bg-surface-base p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
                <Sparkles className="h-4 w-4 text-primary" />
                Build with AI
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={aiTopic}
                  placeholder="Optional topic — e.g. arrays, recursion, strings"
                  disabled={aiBuilding}
                  onChange={(e) => setAiTopic(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  loading={aiBuilding}
                  disabled={aiBuilding}
                  onClick={() => void aiBuild()}
                  className="shrink-0"
                >
                  <Sparkles className="h-4 w-4" /> Build with AI
                </Button>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                Drafts a challenge matching the selected <b>Type</b> (MCQ or
                code) for you to review. It is not auto-validated here — verify
                the correct option / the test cases before saving. (The daily
                auto-generator validates code challenges by execution.)
              </p>
            </div>

            {aiDrafted ? (
              <Alert variant="warning">
                AI draft loaded — review the prompt and verify each test case
                before scheduling.
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Type">
                <Select
                  value={draft.questionType}
                  onValueChange={(v) =>
                    patch({ questionType: v as DailyQuestionTypeT })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DailyQuestionType.MCQ}>MCQ</SelectItem>
                    <SelectItem value={DailyQuestionType.CODE}>Code</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Release date" required>
                <Input
                  type="date"
                  value={draft.releaseDate}
                  onChange={(e) => patch({ releaseDate: e.target.value })}
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

            <FormField label="Title" required>
              <Input
                value={draft.title}
                placeholder="Complexity check"
                onChange={(e) => patch({ title: e.target.value })}
              />
            </FormField>

            <FormField label="Description" hint="Shown to students. Markdown ok.">
              <Textarea
                rows={3}
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </FormField>

            {isMcq ? (
              <FormField
                label="Options"
                hint="At least two. Select the correct answer."
              >
                <div className="space-y-2">
                  {draft.options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="correctOption"
                        aria-label={`Option ${i + 1} is correct`}
                        checked={draft.correctOption === i}
                        onChange={() => patch({ correctOption: i })}
                        className="h-4 w-4 accent-primary"
                      />
                      <Input
                        value={opt}
                        placeholder={`Option ${i + 1}`}
                        onChange={(e) => setOption(i, e.target.value)}
                      />
                      <IconButton
                        aria-label={`Remove option ${i + 1}`}
                        variant="ghost"
                        size="sm"
                        disabled={draft.options.length <= 2}
                        icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                        onClick={() => removeOption(i)}
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={addOption}
                  >
                    <Plus className="h-4 w-4" /> Add option
                  </Button>
                </div>
              </FormField>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Language">
                    <Select
                      value={draft.language}
                      onValueChange={(v) =>
                        patch({ language: v as CodeLanguageT })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.values(CodeLanguage).map((l) => (
                          <SelectItem key={l} value={l}>
                            {CODE_LANGUAGE_LABELS[l]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
                <FormField label="Starter code" hint="Pre-filled in the editor.">
                  <Textarea
                    rows={4}
                    className="font-mono text-xs"
                    value={draft.starterCode}
                    onChange={(e) => patch({ starterCode: e.target.value })}
                  />
                </FormField>
                <FormField
                  label="Test cases"
                  hint="Hidden cases grade the run but never reach the student."
                >
                  <div className="space-y-2">
                    {draft.testCases.map((c, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 rounded-xl border border-subtle p-2"
                      >
                        <div className="grid flex-1 gap-2 sm:grid-cols-2">
                          <Input
                            value={c.input}
                            placeholder="stdin"
                            onChange={(e) => setCase(i, { input: e.target.value })}
                          />
                          <Input
                            value={c.expectedOutput}
                            placeholder="expected stdout"
                            onChange={(e) =>
                              setCase(i, { expectedOutput: e.target.value })
                            }
                          />
                        </div>
                        <label className="flex items-center gap-1 pt-2 text-xs text-ink-muted">
                          <Switch
                            checked={c.isHidden}
                            onCheckedChange={(h) => setCase(i, { isHidden: h })}
                            aria-label={`Case ${i + 1} hidden`}
                          />
                          Hidden
                        </label>
                        <IconButton
                          aria-label={`Remove case ${i + 1}`}
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                          onClick={() => removeCase(i)}
                        />
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={addCase}
                    >
                      <Plus className="h-4 w-4" /> Add test case
                    </Button>
                  </div>
                </FormField>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={submitting}
            disabled={!canSave || (isEdit && !ready)}
            onClick={() => void submit()}
          >
            {isEdit ? "Save changes" : "Schedule challenge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
