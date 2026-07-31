/**
 * Create / edit a GLOBAL bank question (super-admin). Reuses the shared exam
 * QuestionDraft helpers for the type-adaptive payload (options/correct, code
 * fields) and adds the bank metadata (category / subCategory / company /
 * difficulty / tags) + INLINE test cases for CODE (the bank create endpoint takes
 * them in one call). Submits a BankQuestionUpsert to api.adminQuestionBanks.
 */
import {
  CODE_LANGUAGE_VALUES,
  EXAM_QUESTION_TYPE_VALUES,
  ExamQuestionType,
  QUESTION_DIFFICULTY_VALUES,
  QuestionDifficulty,
  type BankQuestion,
  type CodeLanguage as CodeLanguageT,
  type ExamQuestionType as ExamQuestionTypeT,
} from "@codeapt/shared";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import {
  MAX_OPTIONS,
  codeLanguageLabel,
  decodeCorrectOptions,
  emptyQuestionDraft,
  fieldsForType,
  isPolicyLocked,
  questionTypeLabel,
  validateQuestionDraft,
  type QuestionDraft,
} from "../../../lib/exam-authoring.js";
import {
  bankUpsertFromDraft,
  parseTagsInput,
  type BankMeta,
} from "../../../lib/question-bank-ui.js";
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
import { FormField } from "../../ui/form-field.js";
import { IconButton } from "../../ui/icon-button.js";
import { Input } from "../../ui/input.js";
import { RadioGroup, RadioGroupItem } from "../../ui/radio.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { Textarea } from "../../ui/textarea.js";
import { useToast } from "../../ui/toast.js";

const LETTERS = ["A", "B", "C", "D", "E"];

interface DraftTestCase {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
}

function draftFromQuestion(q: BankQuestion): QuestionDraft {
  const base = emptyQuestionDraft(q.questionType);
  return {
    type: q.questionType,
    text: q.text,
    marks: q.marks,
    options: q.options && q.options.length > 0 ? [...q.options] : base.options,
    correctOptions: decodeCorrectOptions(q.correctOptions),
    starterCode: q.starterCode,
    language: q.language,
    allowedLanguages: q.allowedLanguages,
    image: q.image,
  };
}

export function BankQuestionEditorDialog({
  open,
  onOpenChange,
  initial = null,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: BankQuestion | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = initial !== null;

  const [draft, setDraft] = useState<QuestionDraft>(() =>
    initial ? draftFromQuestion(initial) : emptyQuestionDraft(ExamQuestionType.MCQ_SINGLE),
  );
  const [meta, setMeta] = useState<Omit<BankMeta, "tags">>(() => ({
    category: initial?.category ?? "",
    subCategory: initial?.subCategory ?? "",
    company: initial?.company ?? "General",
    difficulty: initial?.difficulty ?? QuestionDifficulty.MEDIUM,
  }));
  const [tagsInput, setTagsInput] = useState(initial?.tags.join(", ") ?? "");
  const [testCases, setTestCases] = useState<DraftTestCase[]>(() =>
    (initial?.testCases ?? []).map((t) => ({
      input: t.input,
      expectedOutput: t.expectedOutput,
      isHidden: t.isHidden,
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const shape = fieldsForType(draft.type);
  const patch = (next: Partial<QuestionDraft>): void =>
    setDraft((d) => ({ ...d, ...next }));

  const changeType = (type: ExamQuestionTypeT): void => {
    setDraft((d) => ({ ...d, type, correctOptions: [] }));
    setErrors({});
  };
  const setOption = (index: number, value: string): void =>
    setDraft((d) => {
      const options = [...d.options];
      options[index] = value;
      return { ...d, options };
    });
  const addOption = (): void =>
    setDraft((d) =>
      d.options.length >= MAX_OPTIONS ? d : { ...d, options: [...d.options, ""] },
    );
  const toggleMultiCorrect = (index: number, checked: boolean): void =>
    setDraft((d) => {
      const set = new Set(d.correctOptions);
      if (checked) set.add(index);
      else set.delete(index);
      return { ...d, correctOptions: [...set] };
    });

  const patchTestCase = (i: number, next: Partial<DraftTestCase>): void =>
    setTestCases((tcs) => tcs.map((t, idx) => (idx === i ? { ...t, ...next } : t)));
  const addTestCase = (): void =>
    setTestCases((tcs) =>
      tcs.length >= 5
        ? tcs
        : [...tcs, { input: "", expectedOutput: "", isHidden: false }],
    );
  const removeTestCase = (i: number): void =>
    setTestCases((tcs) => tcs.filter((_, idx) => idx !== i));

  const submit = async (): Promise<void> => {
    const validation = validateQuestionDraft(draft);
    if (!meta.category.trim()) validation.category = "Category is required";
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setFormError("");
    setSubmitting(true);
    try {
      const payload = bankUpsertFromDraft(
        draft,
        { ...meta, tags: parseTagsInput(tagsInput) },
        testCases.map((t, i) => ({ ...t, order: i })),
      );
      if (isEdit) {
        await api.adminQuestionBanks.update(initial.id, payload);
      } else {
        await api.adminQuestionBanks.create(payload);
      }
      toast({
        variant: "success",
        title: isEdit ? "Question updated" : "Question added to bank",
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit bank question" : "New bank question"}</DialogTitle>
          <DialogDescription>
            A global bank question. Its payload mirrors an exam question, so it
            copies cleanly when pulled into an exam.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          {/* Metadata */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Category" required error={errors.category}>
              <Input
                placeholder="e.g. Data Structures"
                value={meta.category}
                onChange={(e) => setMeta((m) => ({ ...m, category: e.target.value }))}
              />
            </FormField>
            <FormField label="Sub-category">
              <Input
                placeholder="e.g. Arrays"
                value={meta.subCategory}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, subCategory: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Company">
              <Input
                placeholder="General"
                value={meta.company}
                onChange={(e) => setMeta((m) => ({ ...m, company: e.target.value }))}
              />
            </FormField>
            <FormField label="Difficulty">
              <Select
                value={meta.difficulty}
                onValueChange={(v) =>
                  setMeta((m) => ({ ...m, difficulty: v as QuestionDifficulty }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_DIFFICULTY_VALUES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField label="Tags" hint="Comma-separated (searchable).">
            <Input
              placeholder="arrays, sorting"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </FormField>

          {/* Payload */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Type">
              <Select
                value={draft.type}
                onValueChange={(v) => changeType(v as ExamQuestionTypeT)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXAM_QUESTION_TYPE_VALUES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {questionTypeLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Marks" required error={errors.marks}>
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

          <FormField label="Question text" required error={errors.text}>
            <Textarea
              rows={3}
              value={draft.text}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </FormField>

          {/* MCQ */}
          {shape.options ? (
            <FormField
              label="Options"
              hint={
                shape.singleCorrect
                  ? "Select the one correct option."
                  : "Tick every correct option."
              }
              error={errors.options ?? errors.correctOptions}
            >
              <div className="grid gap-2">
                {draft.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-4 shrink-0 text-center font-mono text-xs text-ink-muted">
                      {LETTERS[i] ?? i + 1}
                    </span>
                    {shape.singleCorrect ? (
                      <RadioGroup
                        value={
                          draft.correctOptions[0] === i ? String(i) : ""
                        }
                        onValueChange={() => patch({ correctOptions: [i] })}
                      >
                        <RadioGroupItem
                          value={String(i)}
                          aria-label={`Mark option ${LETTERS[i] ?? i + 1} correct`}
                        />
                      </RadioGroup>
                    ) : (
                      <Checkbox
                        checked={draft.correctOptions.includes(i)}
                        onCheckedChange={(c) => toggleMultiCorrect(i, c === true)}
                        aria-label={`Mark option ${LETTERS[i] ?? i + 1} correct`}
                      />
                    )}
                    <Input
                      value={opt}
                      placeholder={`Option ${LETTERS[i] ?? i + 1}`}
                      onChange={(e) => setOption(i, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              {draft.options.length < MAX_OPTIONS ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={addOption}
                >
                  <Plus className="h-4 w-4" /> Add option
                </Button>
              ) : null}
            </FormField>
          ) : null}

          {/* CODE */}
          {shape.language ? (
            <>
              <FormField label="Language policy">
                <RadioGroup
                  value={isPolicyLocked(draft.allowedLanguages) ? "locked" : "open"}
                  onValueChange={(v) =>
                    patch({
                      allowedLanguages: v === "locked" ? [draft.language] : [],
                    })
                  }
                  className="gap-2"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="locked" aria-label="Locked to one language" />
                    <span className="text-sm text-ink">Locked to one language</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="open" aria-label="Open to all languages" />
                    <span className="text-sm text-ink">Open — any language</span>
                  </div>
                </RadioGroup>
              </FormField>
              <FormField label="Language">
                <Select
                  value={draft.language}
                  onValueChange={(v) =>
                    patch({
                      language: v as CodeLanguageT,
                      allowedLanguages: isPolicyLocked(draft.allowedLanguages)
                        ? [v as CodeLanguageT]
                        : [],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CODE_LANGUAGE_VALUES.map((l) => (
                      <SelectItem key={l} value={l}>
                        {codeLanguageLabel(l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Starter code">
                <Textarea
                  rows={4}
                  className="font-mono text-sm"
                  value={draft.starterCode}
                  onChange={(e) => patch({ starterCode: e.target.value })}
                />
              </FormField>
              <FormField
                label="Test cases"
                hint="Up to 5. Hidden cases aren't shown to candidates."
              >
                <div className="space-y-2">
                  {testCases.map((tc, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2"
                    >
                      <Input
                        placeholder="Input"
                        value={tc.input}
                        onChange={(e) => patchTestCase(i, { input: e.target.value })}
                      />
                      <Input
                        placeholder="Expected output"
                        value={tc.expectedOutput}
                        onChange={(e) =>
                          patchTestCase(i, { expectedOutput: e.target.value })
                        }
                      />
                      <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <Checkbox
                          checked={tc.isHidden}
                          onCheckedChange={(c) =>
                            patchTestCase(i, { isHidden: c === true })
                          }
                          aria-label="Hidden test case"
                        />
                        Hidden
                      </label>
                      <IconButton
                        aria-label="Remove test case"
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                        onClick={() => removeTestCase(i)}
                      />
                    </div>
                  ))}
                  {testCases.length < 5 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={addTestCase}>
                      <Plus className="h-4 w-4" /> Add test case
                    </Button>
                  ) : null}
                </div>
              </FormField>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" loading={submitting} onClick={() => void submit()}>
            {isEdit ? "Save changes" : "Add to bank"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
