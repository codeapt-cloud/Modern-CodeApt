/**
 * Create or edit a COLLEGE exam's own fields (route-less shell): title, pass %,
 * and org-unit targeting. Unlike the platform-admin ExamSettingsDialog, a college
 * exam has NO curriculum topic (it's standalone) — so this is a plain form, not a
 * topic picker. Create posts to the tenant endpoint and navigates into the editor;
 * edit patches title/pass %/targeting. Total marks are derived from question marks
 * server-side (not editable). Faculty must target ≥1 in-scope unit (server-
 * enforced; a 403 surfaces inline).
 */
import type { OrgUnitTreeNode, Role } from "@codeapt/shared";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, parseApiError } from "../../../lib/api-client.js";
import { canTarget } from "../../../lib/exam-targeting.js";
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
import { useToast } from "../../ui/toast.js";
import { OrgUnitTargetPicker } from "./OrgUnitTargetPicker.js";

export interface CollegeExamSettingsInitial {
  id: string;
  title: string;
  passPercentage: number;
  orgUnitIds: string[];
}

export function CollegeExamSettingsDialog({
  open,
  onOpenChange,
  slug,
  role,
  tree,
  initial = null,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  role: Role;
  tree: OrgUnitTreeNode[];
  /** null → create; an existing exam → edit its fields. */
  initial?: CollegeExamSettingsInitial | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const isEdit = initial !== null;
  const isAdmin = role === "college_admin" || role === "super_admin";

  const [title, setTitle] = useState(initial?.title ?? "");
  const [passPercentage, setPassPercentage] = useState(
    initial?.passPercentage ?? 40,
  );
  const [orgUnitIds, setOrgUnitIds] = useState<string[]>(
    initial?.orgUnitIds ?? [],
  );
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const targetingValid = canTarget(orgUnitIds, isAdmin);

  const submit = async (): Promise<void> => {
    setFormError("");
    setSubmitting(true);
    try {
      if (isEdit) {
        await api.collegeExams.update(slug, initial.id, {
          title: title.trim(),
          passPercentage,
          orgUnitIds,
        });
        toast({ variant: "success", title: "Exam updated" });
        onOpenChange(false);
        onSaved();
      } else {
        const detail = await api.collegeExams.create(slug, {
          title: title.trim(),
          passPercentage,
          orgUnitIds,
        });
        toast({ variant: "success", title: "Exam created" });
        onOpenChange(false);
        onSaved();
        navigate(`/c/${slug}/exams/${detail.id}`);
      }
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Exam settings" : "New exam"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the title, pass mark, and which cohorts this exam targets."
              : "Create a standalone exam for your college. You'll add sections and questions next. Total marks are computed from the question marks."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

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

          <FormField
            label="Target cohorts"
            hint={
              isAdmin
                ? "Leave empty for the whole college, or pick specific sections."
                : "Pick the section(s) this exam is for (within your scope)."
            }
          >
            <OrgUnitTargetPicker
              tree={tree}
              value={orgUnitIds}
              onChange={setOrgUnitIds}
              role={role}
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={submitting}
            disabled={title.trim() === "" || !targetingValid}
            onClick={() => void submit()}
          >
            {isEdit ? "Save changes" : "Create exam"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
