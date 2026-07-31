/**
 * Faculty create / edit-scope dialog. Create captures the account basics + an
 * org-unit multi-select (which units the member manages); the account is created
 * with forcePasswordChange, so the invitee sets their own password on first login
 * (surfaced as a hint). Edit mode only changes the assigned scope (identity is
 * immutable here). Org-unit options come from the college's flattened tree, shown
 * with their full path so nested units are unambiguous. Mirrors CollegeEditorDialog.
 */
import {
  passwordSchema,
  usernameSchema,
  type CreateFacultyInput,
  type Faculty,
  type OrgUnitTreeNode,
  type UpdateFacultyInput,
} from "@codeapt/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";

/** Reuse the canonical shared rules for instant, accurate field feedback. */
const validateUsername = (v: string): true | string => {
  const r = usernameSchema.safeParse(v.trim());
  return r.success || (r.error.issues[0]?.message ?? "Invalid username");
};
const validatePassword = (v: string): true | string => {
  const r = passwordSchema.safeParse(v);
  return r.success || (r.error.issues[0]?.message ?? "Invalid password");
};

import { api, parseApiError } from "../../lib/api-client.js";
import { flattenTree, orgUnitTypeLabel } from "../../lib/org-structure-ui.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
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
import { useToast } from "../ui/toast.js";

interface FacultyFormValues {
  fullName: string;
  username: string;
  email: string;
  password: string;
}

export interface FacultyEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  /** null → create; a Faculty → edit that member's scope. */
  initial: Faculty | null;
  /** The college's org-unit tree, for the scope multi-select. */
  tree: OrgUnitTreeNode[];
  onSaved: (faculty: Faculty) => void;
}

export function FacultyEditorDialog({
  open,
  onOpenChange,
  slug,
  initial,
  tree,
  onSaved,
}: FacultyEditorDialogProps) {
  const { toast } = useToast();
  const isEdit = initial !== null;
  const [formError, setFormError] = useState("");
  const [scope, setScope] = useState<Set<string>>(
    new Set(initial?.orgUnitIds ?? []),
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FacultyFormValues>({
    defaultValues: { fullName: "", username: "", email: "", password: "" },
  });

  const flat = flattenTree(tree);

  const toggleUnit = (id: string) =>
    setScope((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onSubmit = handleSubmit(async (v) => {
    setFormError("");
    try {
      let saved: Faculty;
      if (isEdit) {
        const body: UpdateFacultyInput = { orgUnitIds: [...scope] };
        saved = await api.collegeFaculty.update(slug, initial.id, body);
      } else {
        const body: CreateFacultyInput = {
          fullName: v.fullName.trim(),
          username: v.username.trim(),
          email: v.email.trim().toLowerCase(),
          password: v.password,
          orgUnitIds: [...scope],
        };
        saved = await api.collegeFaculty.create(slug, body);
      }
      toast({
        variant: "success",
        title: isEdit ? "Scope updated" : "Faculty invited",
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
          <DialogTitle>
            {isEdit ? `Edit ${initial.fullName}'s scope` : "Invite faculty"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Change which org-units this faculty member manages."
              : "Create a faculty account. They'll set their own password on first login."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          {isEdit ? (
            <div className="rounded-lg border border-subtle bg-surface-base/50 p-3 text-sm">
              <p className="font-medium text-ink">{initial.fullName}</p>
              <p className="text-ink-muted">
                {initial.email} · @{initial.username}
              </p>
            </div>
          ) : (
            <>
              <FormField
                label="Full name"
                required
                error={errors.fullName?.message}
              >
                <Input
                  placeholder="Dr. A. Sharma"
                  {...register("fullName", { required: "Name is required" })}
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Username"
                  required
                  hint="3–30 chars: letters, digits, and _ . -"
                  error={errors.username?.message}
                >
                  <Input
                    placeholder="asharma"
                    {...register("username", {
                      required: "Username is required",
                      validate: validateUsername,
                    })}
                  />
                </FormField>
                <FormField label="Email" required error={errors.email?.message}>
                  <Input
                    type="email"
                    placeholder="asharma@college.edu"
                    {...register("email", { required: "Email is required" })}
                  />
                </FormField>
              </div>
              <FormField
                label="Initial password"
                required
                hint="8+ chars with an uppercase, a lowercase and a digit. They'll change it on first login."
                error={errors.password?.message}
              >
                <Input
                  type="text"
                  placeholder="e.g. Welcome123"
                  {...register("password", {
                    required: "Password is required",
                    validate: validatePassword,
                  })}
                />
              </FormField>
            </>
          )}

          <FormField
            label="Assigned org-units"
            hint="Which parts of the structure this member manages."
          >
            {flat.length === 0 ? (
              <p className="rounded-lg border border-subtle bg-surface-base/50 px-3 py-2 text-sm text-ink-muted">
                No org-units yet — build the structure first, then assign scope.
              </p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-subtle p-2">
                {flat.map((u) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-overlay"
                    style={{ paddingLeft: `${0.5 + u.depth * 1}rem` }}
                  >
                    <Checkbox
                      checked={scope.has(u.id)}
                      onCheckedChange={() => toggleUnit(u.id)}
                    />
                    <span className="flex-1 truncate text-sm text-ink">
                      {u.name}
                    </span>
                    <Badge variant="outline">{orgUnitTypeLabel(u.type)}</Badge>
                  </label>
                ))}
              </div>
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
            <Button type="submit" loading={isSubmitting}>
              {isEdit ? "Save scope" : "Invite faculty"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
