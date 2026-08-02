/**
 * Full-Exam AI Build — a WHOLE-EXAM action opened from the exam editor header.
 * Faculty describe the exam, pick question types, how many SECTIONS to create and
 * how many questions per section, and difficulty; on Generate the LLM designs the
 * exam (section names + durations + questions) and the server CREATES the sections
 * and inserts the validated questions (appending after any existing sections),
 * mirroring them into the college Self Bank. Degrades gracefully when the LLM
 * isn't configured (a clear message, no crash).
 *
 * For adding questions to a SINGLE existing section, use the per-section
 * "AI Build" button (SectionAiBuildDialog) instead.
 */
import {
  EXAM_QUESTION_TYPE_VALUES,
  MAX_AI_EXAM_SECTIONS,
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
  buildAiGenerateExamRequest,
  clampCount,
  clampSectionCount,
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
  sectionsCreated: number;
  created: number;
  skipped: number;
}

export function FullExamAIBuildDialog({
  open,
  onOpenChange,
  slug,
  examId,
  hasExistingSections,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  examId: string;
  /** Whether the exam already has sections (a full build APPENDS new ones). */
  hasExistingSections: boolean;
  /** Refetch the exam tree after the exam is built. */
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

  const sectionCount = clampSectionCount(state.sectionCount);
  const perSection = clampCount(state.perSection);
  const total = sectionCount * perSection;

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
      const res = await api.collegeQuestionBanks.aiGenerateExam(
        slug,
        buildAiGenerateExamRequest(state, examId),
      );
      setResult(res);
      if (res.configured && res.created > 0) {
        toast({
          variant: "success",
          title: `Built ${res.sectionsCreated} section${
            res.sectionsCreated === 1 ? "" : "s"
          } · ${res.created} question${res.created === 1 ? "" : "s"} total`,
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
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Full Exam AI Build
            </span>
          </DialogTitle>
          <DialogDescription>
            Describe the exam and let AI design it end-to-end — it creates the
            sections and drafts questions into each. Every question is validated
            into a real exam question before it's added, and also saved to your
            Self Bank.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          {hasExistingSections ? (
            <Alert variant="info">
              This exam already has sections. A full build ADDS new sections after
              them — it never removes your existing work. To add questions to one
              existing section, use that section's <b>AI Build</b> button.
            </Alert>
          ) : null}

          {result && !result.configured ? (
            <Alert variant="warning">
              AI generation isn't configured — contact your administrator to
              enable the AI provider.
            </Alert>
          ) : null}

          {result && result.configured ? (
            <Alert variant={result.created > 0 ? "success" : "warning"}>
              Created {result.sectionsCreated} section
              {result.sectionsCreated === 1 ? "" : "s"} with {result.created}{" "}
              question{result.created === 1 ? "" : "s"} total
              {result.skipped > 0 ? `, skipped ${result.skipped}` : ""}.
            </Alert>
          ) : null}

          <FormField
            label="Describe the exam"
            hint="Topics, focus areas, and the style of questions you want."
          >
            <Textarea
              rows={4}
              placeholder="e.g. A 3-round campus-placement test: an aptitude section (arrays, time-and-work), a CS-fundamentals section (DBMS, OS), and a coding section on strings & recursion."
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
            <p className="mt-1 text-xs text-ink-muted">
              True/False and Fill-in-the-blank aren't supported by the exam engine.
            </p>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Sections" hint={`Up to ${MAX_AI_EXAM_SECTIONS}.`}>
              <Input
                type="number"
                min={1}
                max={MAX_AI_EXAM_SECTIONS}
                value={String(state.sectionCount)}
                onChange={(e) =>
                  patch({ sectionCount: clampSectionCount(Number(e.target.value)) })
                }
              />
            </FormField>
            <FormField
              label="Questions / section"
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

          <p className="rounded-lg border border-subtle bg-surface-base p-3 text-xs text-ink-secondary">
            Creates{" "}
            <span className="font-medium text-ink">
              {sectionCount} section{sectionCount === 1 ? "" : "s"}
            </span>{" "}
            with up to{" "}
            <span className="font-medium text-ink">
              {perSection} × {sectionCount} = {total}
            </span>{" "}
            question{total === 1 ? "" : "s"} total.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {result && result.created > 0 ? "Done" : "Cancel"}
          </Button>
          <Button type="button" loading={busy} onClick={() => void submit()}>
            <Sparkles className="h-4 w-4" /> Build exam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
