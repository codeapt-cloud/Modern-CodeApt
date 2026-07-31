/**
 * Single-add / edit college-student dialog. Create captures the account basics +
 * a single org-unit assignment; the account is created with a temp password +
 * forcePasswordChange (surfaced as a hint) so the student sets their own on first
 * login. Edit mode changes the same details (name / email / roll / org-unit) on
 * an existing student — changing the email also moves their login handle and logs
 * them out. Org-units are picked from the college's flattened tree, shown with
 * full path so nested units are unambiguous. Faculty see the whole tree here; the
 * backend enforces their scope (an out-of-scope unit → a clear 403), so we surface
 * that inline. Mirrors FacultyEditorDialog.
 */
import {
  type CollegeStudent,
  type CreateCollegeStudentInput,
  type OrgUnitTreeNode,
  type UpdateCollegeStudentInput,
} from "@codeapt/shared";
import { useForm } from "react-hook-form";
import { useState } from "react";

import { api, parseApiError } from "../../lib/api-client.js";
import { flattenTree, orgUnitTypeLabel } from "../../lib/org-structure-ui.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { FormField } from "../ui/form-field.js";
import { Input } from "../ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { useToast } from "../ui/toast.js";

interface StudentFormValues {
  fullName: string;
  email: string;
  rollNumber: string;
}

export interface StudentEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  /** null → create; a CollegeStudent → edit that student's details. */
  initial?: CollegeStudent | null;
  /** The college's org-unit tree, for the assignment picker. */
  tree: OrgUnitTreeNode[];
  onSaved: (student: CollegeStudent) => void;
}

export function StudentEditorDialog({
  open,
  onOpenChange,
  slug,
  initial = null,
  tree,
  onSaved,
}: StudentEditorDialogProps) {
  const { toast } = useToast();
  const isEdit = initial !== null;
  const [formError, setFormError] = useState("");
  const [orgUnitId, setOrgUnitId] = useState(initial?.orgUnitId ?? "");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StudentFormValues>({
    defaultValues: {
      fullName: initial?.fullName ?? "",
      email: initial?.email ?? "",
      rollNumber: initial?.rollNumber ?? "",
    },
  });

  const flat = flattenTree(tree);

  const onSubmit = handleSubmit(async (v) => {
    setFormError("");
    if (!orgUnitId) {
      setFormError("Pick an org-unit to assign the student to.");
      return;
    }
    try {
      let saved: CollegeStudent;
      if (isEdit) {
        const body: UpdateCollegeStudentInput = {
          fullName: v.fullName.trim(),
          email: v.email.trim().toLowerCase(),
          rollNumber: v.rollNumber.trim(),
          orgUnitId,
        };
        saved = await api.collegeStudents.update(slug, initial.id, body);
      } else {
        const body: CreateCollegeStudentInput = {
          fullName: v.fullName.trim(),
          email: v.email.trim().toLowerCase(),
          rollNumber: v.rollNumber.trim(),
          orgUnitId,
        };
        saved = await api.collegeStudents.create(slug, body);
      }
      toast({
        variant: "success",
        title: isEdit ? "Student updated" : "Student added",
      });
      onOpenChange(false);
      onSaved(saved);
    } catch (err) {
      setFormError(parseApiError(err).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit student" : "Add student"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this student's details. Changing the email also changes their login and logs them out."
              : "Create a student account. They'll set their own password on first login."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <FormField label="Full name" required error={errors.fullName?.message}>
            <Input
              placeholder="Asha Rao"
              {...register("fullName", { required: "Name is required" })}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Email" required error={errors.email?.message}>
              <Input
                type="email"
                placeholder="asha@college.edu"
                {...register("email", { required: "Email is required" })}
              />
            </FormField>
            <FormField
              label="Roll number"
              required
              hint="Unique within your college."
              error={errors.rollNumber?.message}
            >
              <Input
                placeholder="CS2026001"
                {...register("rollNumber", {
                  required: "Roll number is required",
                })}
              />
            </FormField>
          </div>

          <FormField
            label="Org-unit"
            required
            hint="The department / year / section / semester this student belongs to."
          >
            {flat.length === 0 ? (
              <p className="rounded-lg border border-subtle bg-surface-base/50 px-3 py-2 text-sm text-ink-muted">
                No org-units yet — build the structure first, then add students.
              </p>
            ) : (
              <Select value={orgUnitId} onValueChange={setOrgUnitId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an org-unit…" />
                </SelectTrigger>
                <SelectContent>
                  {flat.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.path}{" "}
                      <span className="text-ink-muted">
                        ({orgUnitTypeLabel(u.type)})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={flat.length === 0}
            >
              {isEdit ? "Save changes" : "Add student"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
