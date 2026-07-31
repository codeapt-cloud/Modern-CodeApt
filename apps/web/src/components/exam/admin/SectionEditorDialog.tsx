/**
 * Add a section to an exam. createSection returns the full refreshed exam tree,
 * which the editor page adopts directly.
 */
import type { AdminExamDetail } from "@codeapt/shared";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import type { ExamAuthoringApi } from "../../../lib/exam-authoring-api.js";
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
import { Input } from "../../ui/input.js";
import { Textarea } from "../../ui/textarea.js";
import { useToast } from "../../ui/toast.js";

export interface EditableSection {
  id: string;
  name: string;
  order: number;
  durationMinutes: number;
  description: string;
}

export function SectionEditorDialog({
  open,
  onOpenChange,
  examId,
  nextOrder,
  initial = null,
  onSaved,
  authApi = api.adminExams,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  nextOrder: number;
  /** null → create; an existing section → edit. */
  initial?: EditableSection | null;
  onSaved: (detail: AdminExamDetail) => void;
  /** Authoring backend — defaults to the platform admin api; the college editor
   * injects a slug-bound tenant adapter. */
  authApi?: ExamAuthoringApi;
}) {
  const { toast } = useToast();
  const isEdit = initial !== null;
  const [name, setName] = useState(initial?.name ?? "");
  const [order, setOrder] = useState(initial?.order ?? nextOrder);
  const [durationMinutes, setDurationMinutes] = useState(
    initial?.durationMinutes ?? 30,
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setFormError("");
    setSubmitting(true);
    try {
      const body = { name: name.trim(), order, durationMinutes, description };
      const detail = isEdit
        ? await authApi.updateSection(initial.id, body)
        : await authApi.createSection(examId, body);
      toast({
        variant: "success",
        title: isEdit ? "Section updated" : "Section added",
      });
      onOpenChange(false);
      onSaved(detail);
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit section" : "Add section"}</DialogTitle>
          <DialogDescription>
            Sections are timed independently and taken in order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <FormField label="Name" required>
            <Input
              value={name}
              placeholder="Quantitative Aptitude"
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Order" hint="Lower shows first.">
              <Input
                type="number"
                min={0}
                value={String(order)}
                onChange={(e) =>
                  setOrder(Math.max(0, Math.trunc(Number(e.target.value)) || 0))
                }
              />
            </FormField>
            <FormField label="Duration (minutes)" required>
              <Input
                type="number"
                min={1}
                value={String(durationMinutes)}
                onChange={(e) =>
                  setDurationMinutes(
                    Math.max(1, Math.trunc(Number(e.target.value)) || 1),
                  )
                }
              />
            </FormField>
          </div>

          <FormField label="Description" hint="Optional.">
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            loading={submitting}
            disabled={name.trim() === ""}
            onClick={() => void submit()}
          >
            {isEdit ? "Save changes" : "Add section"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
