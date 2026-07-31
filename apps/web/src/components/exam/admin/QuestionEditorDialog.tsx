/**
 * Add a question to a section — the type-adaptive authoring form. The visible
 * fields and the `correctOptions` encoding are driven entirely by the pure
 * helpers in `lib/exam-authoring` (unit-tested), so this component stays a thin
 * shell over that logic. The server re-validates on submit (parseApiError →
 * inline). CODE test cases are added afterwards (they need the question id).
 */
import {
  CODE_LANGUAGE_VALUES,
  EXAM_QUESTION_TYPE_VALUES,
  ExamQuestionType,
  type CodeLanguage as CodeLanguageT,
  type ExamQuestionType as ExamQuestionTypeT,
} from "@codeapt/shared";
import { Plus } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import type { ExamAuthoringApi } from "../../../lib/exam-authoring-api.js";
import { ImageUpload } from "../../media/ImageUpload.js";
import {
  MAX_OPTIONS,
  codeLanguageLabel,
  decodeCorrectOptions,
  emptyQuestionDraft,
  fieldsForType,
  isPolicyLocked,
  questionTypeLabel,
  toQuestionUpsert,
  validateQuestionDraft,
  type QuestionDraft,
} from "../../../lib/exam-authoring.js";
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

/** An existing question being edited (subset of the admin detail shape). */
export interface EditableQuestion {
  id: string;
  type: ExamQuestionTypeT;
  text: string;
  marks: number;
  options?: string[] | null;
  correctOptions?: number[] | null;
  starterCode?: string;
  language: CodeLanguageT;
  allowedLanguages?: CodeLanguageT[];
  image?: string;
}

function draftFromQuestion(q: EditableQuestion): QuestionDraft {
  const base = emptyQuestionDraft(q.type);
  return {
    type: q.type,
    text: q.text,
    marks: q.marks,
    options: q.options && q.options.length > 0 ? [...q.options] : base.options,
    correctOptions: decodeCorrectOptions(q.correctOptions),
    starterCode: q.starterCode ?? "",
    language: q.language,
    allowedLanguages: q.allowedLanguages ?? [],
    image: q.image ?? "",
  };
}

export interface QuestionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  sectionName: string;
  /** Order to assign the new question (append at the end of the section). */
  order: number;
  /** null → create; an existing question → edit. */
  initial?: EditableQuestion | null;
  onSaved: () => void;
  /** Authoring backend — defaults to the platform admin api; the college editor
   * injects a slug-bound tenant adapter. */
  authApi?: ExamAuthoringApi;
}

export function QuestionEditorDialog({
  open,
  onOpenChange,
  sectionId,
  sectionName,
  order,
  initial = null,
  onSaved,
  authApi = api.adminExams,
}: QuestionEditorDialogProps) {
  const { toast } = useToast();
  const isEdit = initial !== null;
  const [draft, setDraft] = useState<QuestionDraft>(() =>
    initial ? draftFromQuestion(initial) : emptyQuestionDraft(ExamQuestionType.MCQ_SINGLE),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const shape = fieldsForType(draft.type);

  const patch = (next: Partial<QuestionDraft>): void =>
    setDraft((d) => ({ ...d, ...next }));

  const changeType = (type: ExamQuestionTypeT): void => {
    // Preserve shared fields (text/marks); reset the correct selection since
    // single↔multi semantics differ.
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
      d.options.length >= MAX_OPTIONS
        ? d
        : { ...d, options: [...d.options, ""] },
    );

  const toggleMultiCorrect = (index: number, checked: boolean): void =>
    setDraft((d) => {
      const set = new Set(d.correctOptions);
      if (checked) set.add(index);
      else set.delete(index);
      return { ...d, correctOptions: [...set] };
    });

  const submit = async (): Promise<void> => {
    const validation = validateQuestionDraft(draft);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setFormError("");
    setSubmitting(true);
    try {
      const payload = toQuestionUpsert(draft, sectionId, order);
      if (isEdit) {
        await authApi.updateQuestion(initial.id, payload);
      } else {
        await authApi.createQuestion(payload);
      }
      toast({
        variant: "success",
        title: isEdit ? "Question updated" : "Question added",
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
          <DialogTitle>{isEdit ? "Edit question" : "Add question"}</DialogTitle>
          <DialogDescription>
            Section: <span className="text-ink">{sectionName}</span>. The form
            adapts to the question type.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

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

          <FormField
            label="Image (optional)"
            hint="An illustrative image shown with the question. Upload or paste a URL."
          >
            <ImageUpload
              value={draft.image}
              onChange={(url) => patch({ image: url })}
            />
          </FormField>

          {/* MCQ: options + correct selection */}
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
              {shape.singleCorrect ? (
                <RadioGroup
                  value={
                    draft.correctOptions.length > 0
                      ? String(draft.correctOptions[0])
                      : ""
                  }
                  onValueChange={(v) => patch({ correctOptions: [Number(v)] })}
                  className="gap-2"
                >
                  {draft.options.map((opt, i) => (
                    <OptionRow key={i} letter={LETTERS[i] ?? String(i + 1)}>
                      <RadioGroupItem
                        value={String(i)}
                        aria-label={`Mark option ${LETTERS[i] ?? i + 1} correct`}
                      />
                      <Input
                        value={opt}
                        placeholder={`Option ${LETTERS[i] ?? i + 1}`}
                        onChange={(e) => setOption(i, e.target.value)}
                      />
                    </OptionRow>
                  ))}
                </RadioGroup>
              ) : (
                <div className="grid gap-2">
                  {draft.options.map((opt, i) => (
                    <OptionRow key={i} letter={LETTERS[i] ?? String(i + 1)}>
                      <Checkbox
                        checked={draft.correctOptions.includes(i)}
                        onCheckedChange={(c) =>
                          toggleMultiCorrect(i, c === true)
                        }
                        aria-label={`Mark option ${LETTERS[i] ?? i + 1} correct`}
                      />
                      <Input
                        value={opt}
                        placeholder={`Option ${LETTERS[i] ?? i + 1}`}
                        onChange={(e) => setOption(i, e.target.value)}
                      />
                    </OptionRow>
                  ))}
                </div>
              )}
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

          {/* CODE: language policy + language + starter code */}
          {shape.language ? (
            <FormField
              label="Language policy"
              hint="Locked forces one language; Open lets students pick any supported language."
            >
              <RadioGroup
                value={isPolicyLocked(draft.allowedLanguages) ? "locked" : "open"}
                onValueChange={(v) =>
                  patch({
                    // Locked → allow exactly the authored language; open → [].
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
                  <span className="text-sm text-ink">
                    Open — students choose any language
                  </span>
                </div>
              </RadioGroup>
            </FormField>
          ) : null}
          {shape.language ? (
            <FormField
              label={
                isPolicyLocked(draft.allowedLanguages)
                  ? "Locked language"
                  : "Authored language (for the starter code)"
              }
            >
              <Select
                value={draft.language}
                onValueChange={(v) =>
                  patch({
                    language: v as CodeLanguageT,
                    // Keep the locked language in sync with the chosen one.
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
          ) : null}
          {shape.starterCode ? (
            <FormField
              label="Starter code"
              hint="Pre-filled in the candidate's editor. Add test cases after creating the question."
            >
              <Textarea
                rows={5}
                className="font-mono text-sm"
                value={draft.starterCode}
                onChange={(e) => patch({ starterCode: e.target.value })}
              />
            </FormField>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" loading={submitting} onClick={() => void submit()}>
            {isEdit ? "Save changes" : "Add question"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptionRow({
  letter,
  children,
}: {
  letter: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-4 shrink-0 text-center font-mono text-xs text-ink-muted">
        {letter}
      </span>
      {children}
    </div>
  );
}
