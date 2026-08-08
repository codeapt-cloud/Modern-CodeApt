/**
 * Create or edit an exam's own fields via the upsert endpoint.
 *
 * The exam is 1:1 with a curriculum Topic and the backend keys the upsert by
 * `topicId` (POST /admin/exams → findOneAndUpdate on { topic }).
 *
 * Exam-picker reconciliation (Step 4b-ii): an exam-type Topic auto-creates its
 * Exam shell in curriculum authoring, so "New exam" no longer creates from
 * scratch — it lets you PICK an exam-type topic (by Subject › Module › Topic)
 * and open/configure its exam. The upsert is idempotent (keyed by the topic),
 * so selecting a topic that already has an exam simply opens it. Admins never
 * paste a topic id again. EDIT reuses the exam's known topicId (fixed).
 * `totalMarks` is derived server-side from question marks and isn't editable.
 */
import type { AdminExamDetail } from "@codeapt/shared";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";
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
import { EmptyState } from "../../ui/empty-state.js";
import { FormField } from "../../ui/form-field.js";
import { Input } from "../../ui/input.js";
import { Switch } from "../../ui/switch.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { useToast } from "../../ui/toast.js";

export interface ExamSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create (pick a topic); an exam → edit its title / pass %. */
  initial: AdminExamDetail | null;
  /** Called with the (re)fetched detail after a successful save. */
  onSaved: (detail: AdminExamDetail) => void;
}

export function ExamSettingsDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: ExamSettingsDialogProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const isEdit = initial !== null;

  // The exam-type topic picker (create only).
  const { data: examTopicsData, loading: topicsLoading } = useQuery(
    () => (isEdit ? Promise.resolve({ items: [] }) : api.adminCurriculum.examTopics.list()),
    [isEdit],
  );
  const examTopics = examTopicsData?.items ?? [];

  const [topicId, setTopicId] = useState(initial?.topicId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [passPercentage, setPassPercentage] = useState(
    initial?.passPercentage ?? 40,
  );
  const [calculatorEnabled, setCalculatorEnabled] = useState(
    initial?.calculatorEnabled ?? true,
  );
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onPickTopic = (id: string): void => {
    setTopicId(id);
    // Prefill the title from the topic name when the admin hasn't typed one.
    const picked = examTopics.find((t) => t.topicId === id);
    if (picked && title.trim() === "") setTitle(picked.name);
  };

  const submit = async (): Promise<void> => {
    setFormError("");
    setSubmitting(true);
    try {
      const detail = await api.adminExams.upsert({
        topicId: topicId.trim(),
        title: title.trim(),
        passPercentage,
        calculatorEnabled,
      });
      toast({
        variant: "success",
        title: isEdit ? "Exam updated" : "Exam opened",
      });
      onOpenChange(false);
      onSaved(detail);
      if (!isEdit) navigate(`/admin/exams/${detail.id}`);
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const noTopics = !isEdit && !topicsLoading && examTopics.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Exam settings" : "Open an exam"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the exam title and pass mark. Total marks are computed from the question marks."
              : "Pick an exam-type topic. Its exam already exists (created with the topic) — this opens it to author sections and questions."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          {isEdit ? (
            <FormField label="Linked topic" hint="Fixed for an existing exam.">
              <Input value={topicId} readOnly className="opacity-70" />
            </FormField>
          ) : noTopics ? (
            <EmptyState
              title="No exam topics yet"
              description="Create an exam-type topic under a course module first (Manage curriculum → a course → Manage topics), then it appears here."
            />
          ) : (
            <FormField
              label="Exam topic"
              required
              hint="Choose the exam-type topic this exam belongs to."
            >
              <Select value={topicId} onValueChange={onPickTopic}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a topic…" />
                </SelectTrigger>
                <SelectContent>
                  {examTopics.map((t) => (
                    <SelectItem key={t.topicId} value={t.topicId}>
                      {t.subjectName} › {t.moduleName} › {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          {!noTopics ? (
            <>
              <FormField label="Title" required>
                <Input
                  value={title}
                  placeholder="Placement Mock — Aptitude + Coding"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </FormField>

              <FormField label="Pass percentage" hint="0–100. Default 40.">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={String(passPercentage)}
                  onChange={(e) =>
                    setPassPercentage(
                      Math.min(
                        100,
                        Math.max(0, Math.trunc(Number(e.target.value)) || 0),
                      ),
                    )
                  }
                />
              </FormField>

              <label className="flex items-center gap-2">
                <Switch
                  checked={calculatorEnabled}
                  onCheckedChange={setCalculatorEnabled}
                />
                <span className="text-sm text-ink">
                  Calculator{" "}
                  <span className="text-ink-muted">
                    — show the in-exam calculator to candidates
                  </span>
                </span>
              </label>
            </>
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
          {!noTopics ? (
            <Button
              type="button"
              loading={submitting}
              disabled={topicId.trim() === "" || title.trim() === ""}
              onClick={() => void submit()}
            >
              {isEdit ? "Save changes" : "Open exam"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
