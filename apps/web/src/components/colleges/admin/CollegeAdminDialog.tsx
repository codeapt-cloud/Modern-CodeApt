/**
 * Designate-a-college-admin dialog (super-admin console). Creates a User with
 * role=college_admin, userType=college, college=<this>, forcePasswordChange — so
 * the platform can hand a college its administrator without editing DB fields.
 * They set their own password on first login (surfaced as a hint). Mirrors
 * CollegeEditorDialog / FacultyEditorDialog.
 */
import {
  passwordSchema,
  usernameSchema,
  type CollegeAdmin,
  type CreateCollegeAdminInput,
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
import { Input } from "../../ui/input.js";
import { useToast } from "../../ui/toast.js";

interface AdminFormValues {
  fullName: string;
  username: string;
  email: string;
  password: string;
}

export interface CollegeAdminDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collegeId: string;
  onSaved: (admin: CollegeAdmin) => void;
}

export function CollegeAdminDialog({
  open,
  onOpenChange,
  collegeId,
  onSaved,
}: CollegeAdminDialogProps) {
  const { toast } = useToast();
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AdminFormValues>({
    defaultValues: { fullName: "", username: "", email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError("");
    try {
      const body: CreateCollegeAdminInput = {
        fullName: v.fullName.trim(),
        username: v.username.trim(),
        email: v.email.trim().toLowerCase(),
        password: v.password,
      };
      const saved = await api.adminColleges.createAdmin(collegeId, body);
      toast({ variant: "success", title: "College admin created" });
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
          <DialogTitle>Add college admin</DialogTitle>
          <DialogDescription>
            Create an administrator for this college. They&apos;ll set their own
            password on first login, then get a &ldquo;My college&rdquo; entry to
            their workspace.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <FormField label="Full name" required error={errors.fullName?.message}>
            <Input
              placeholder="Dean Skinner"
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
                placeholder="skinner"
                {...register("username", {
                  required: "Username is required",
                  validate: validateUsername,
                })}
              />
            </FormField>
            <FormField label="Email" required error={errors.email?.message}>
              <Input
                type="email"
                placeholder="admin@college.edu"
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

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Create admin
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
