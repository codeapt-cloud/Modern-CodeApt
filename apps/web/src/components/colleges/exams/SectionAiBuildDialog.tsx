/**
 * Section AI Build — a PER-SECTION action: draft questions into ONE existing
 * section (this section only). Faculty describe what they want, pick question
 * types, how many questions, and difficulty; the LLM output is validated into
 * real exam questions, inserted into this section, and mirrored into the Self
 * Bank. Degrades gracefully when the LLM isn't configured.
 *
 * For building a whole exam (creating sections + questions), use the exam-header
 * "Full Exam AI Build" instead.
 */
import {
  EXAM_QUESTION_TYPE_VALUES,
  MAX_AI_GENERATED_QUESTIONS,
  QUESTION_DIFFICULTY_VALUES,
  type ExamQuestionType as ExamQuestionTypeT,
  type QuestionDifficulty,
} from "@codeapt/shared";
import { Sparkles } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { questionTypeLabel } from "../../../lib/exam-authoring.js";
import {
  buildAiGenerateRequest,
  clampCount,
  emptyAiBuilderState,
  validateAiBuilderState,
  type AiBuilderState,
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
import { Input } from "../../ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { Textarea } from "../../ui/textarea.js";
import { useToast } from "../../ui/toast.js";

const REAL_TYPES = EXAM_QUESTION_TYPE_VALUES;
const UNSUPPORTED_TYPES = ["True / False", "Fill in the blank"] as const;

interface GenerateResult {
  configured: boolean;
  created: number;
  skipped: number;
}

export function SectionAiBuildDialog({
  open,
  onOpenChange,
  slug,
  examId,
  sectionId,
  sectionName,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  examId: string;
  sectionId: string;
  sectionName: string;
  /** Refetch the exam tree after questions are added to this section. */
  onGenerated: () => void;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<AiBuilderState>(emptyAiBuilderState);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);

  const patch = (next: Partial<AiBuilderState>): void =>
    setState((s) => ({ ...s, ...next }));

  const toggleType = (type: ExamQuestionTypeT, checked: boolean): void =>
    setState((s) => {
      const set = new Set(s.types);
      if (checked) set.add(type);
      else set.delete(type);
      return { ...s, types: REAL_TYPES.filter((t) => set.has(t)) };
    });

  const submit = async (): Promise<void> => {
    const error = validateAiBuilderState(state);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError("");
    setBusy(true);
    setResult(null);
    try {
      const res = await api.collegeQuestionBanks.aiGenerate(
        slug,
        buildAiGenerateRequest(state, examId, sectionId),
      );
      setResult(res);
      if (res.configured && res.created > 0) {
        toast({
          variant: "success",
          title: `Added ${res.created} question${
            res.created === 1 ? "" : "s"
          } to "${sectionName}"`,
        });
        onGenerated();
      }
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> AI Build — {sectionName}
            </span>
          </DialogTitle>
          <DialogDescription>
            Draft questions into this section with AI. Each is validated into a
            real exam question before it's added, and also saved to your Self Bank.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          {result && !result.configured ? (
            <Alert variant="warning">
              AI generation isn't configured — contact your administrator to
              enable the AI provider.
            </Alert>
          ) : null}

          {result && result.configured ? (
            <Alert variant={result.created > 0 ? "success" : "warning"}>
              Added {result.created} question{result.created === 1 ? "" : "s"} to{" "}
              {sectionName}
              {result.skipped > 0 ? `, skipped ${result.skipped}` : ""}.
            </Alert>
          ) : null}

          <FormField
            label="Describe the questions"
            hint="Topics, focus areas, and the style of questions you want."
          >
            <Textarea
              rows={4}
              placeholder="e.g. Five medium MCQs on time-and-work and percentages, plus one coding question on string reversal."
              value={state.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </FormField>

          <FormField label="Question types">
            <div className="grid gap-2 sm:grid-cols-2">
              {REAL_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm text-ink">
                  <Checkbox
                    checked={state.types.includes(t)}
                    onCheckedChange={(c) => toggleType(t, c === true)}
                    aria-label={questionTypeLabel(t)}
                  />
                  {questionTypeLabel(t)}
                </label>
              ))}
              {UNSUPPORTED_TYPES.map((label) => (
                <label
                  key={label}
                  className="flex items-center gap-2 text-sm text-ink-muted"
                  title="Not supported by the exam engine"
                >
                  <Checkbox checked={false} disabled aria-label={label} />
                  {label}
                </label>
              ))}
            </div>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Number of questions"
              hint={`Up to ${MAX_AI_GENERATED_QUESTIONS}.`}
            >
              <Input
                type="number"
                min={1}
                max={MAX_AI_GENERATED_QUESTIONS}
                value={String(state.perSection)}
                onChange={(e) =>
                  patch({ perSection: clampCount(Number(e.target.value)) })
                }
              />
            </FormField>
            <FormField label="Difficulty">
              <Select
                value={state.difficulty}
                onValueChange={(v) => patch({ difficulty: v as QuestionDifficulty })}
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
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {result && result.created > 0 ? "Done" : "Cancel"}
          </Button>
          <Button type="button" loading={busy} onClick={() => void submit()}>
            <Sparkles className="h-4 w-4" /> Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
