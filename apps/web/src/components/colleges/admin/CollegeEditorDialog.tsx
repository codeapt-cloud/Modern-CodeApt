/**
 * College create/edit dialog (basics only — entitlements live on the manage
 * page). Slug is set at creation and is IMMUTABLE afterwards (it is the
 * /c/:slug tenant key), so on edit it is shown read-only. Slug validation
 * mirrors the backend: lowercase, url-safe, hyphen-separated. Server errors
 * (e.g. COLLEGE_SLUG_TAKEN) surface inline.
 */
import {
  CollegeStatus,
  type College,
  type CollegeStatus as CollegeStatusT,
  type CreateCollegeInput,
  type UpdateCollegeInput,
} from "@codeapt/shared";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { useToast } from "../../ui/toast.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface CollegeFormValues {
  name: string;
  slug: string;
  contactEmail: string;
  contactPhone: string;
  status: CollegeStatusT;
}

function toDefaults(c: College | null): CollegeFormValues {
  return {
    name: c?.name ?? "",
    slug: c?.slug ?? "",
    contactEmail: c?.contactEmail ?? "",
    contactPhone: c?.contactPhone ?? "",
    status: (c?.status ?? CollegeStatus.ACTIVE) as CollegeStatusT,
  };
}

export interface CollegeEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; a College → edit. */
  initial: College | null;
  /** Receives the saved college so callers can refresh in place. */
  onSaved: (college: College) => void;
}

export function CollegeEditorDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: CollegeEditorDialogProps) {
  const { toast } = useToast();
  const isEdit = initial !== null;
  const [formError, setFormError] = useState("");

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CollegeFormValues>({ defaultValues: toDefaults(initial) });

  const onSubmit = handleSubmit(async (v) => {
    setFormError("");
    try {
      let saved: College;
      if (isEdit) {
        const body: UpdateCollegeInput = {
          name: v.name.trim(),
          contactEmail: v.contactEmail.trim(),
          contactPhone: v.contactPhone.trim(),
          status: v.status,
        };
        saved = await api.adminColleges.update(initial.id, body);
      } else {
        const body: CreateCollegeInput = {
          name: v.name.trim(),
          slug: v.slug.trim().toLowerCase(),
          contactEmail: v.contactEmail.trim(),
          contactPhone: v.contactPhone.trim(),
          status: v.status,
        };
        saved = await api.adminColleges.create(body);
      }
      toast({
        variant: "success",
        title: isEdit ? "College updated" : "College created",
      });
      onOpenChange(false);
      onSaved(saved);
    } catch (err) {
      setFormError(parseApiError(err).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit college" : "New college"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the college's basics. The slug is permanent."
              : "Provision a new college tenant. Configure its features and courses next, from Manage."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <FormField label="Name" required error={errors.name?.message}>
            <Input
              placeholder="Springfield Institute of Technology"
              {...register("name", { required: "Name is required" })}
            />
          </FormField>

          <FormField
            label="Slug"
            required={!isEdit}
            hint={
              isEdit
                ? "Permanent — the /c/:slug tenant key cannot change."
                : "Lowercase, url-safe (e.g. springfield-tech). Permanent once set."
            }
            error={errors.slug?.message}
          >
            <Input
              placeholder="springfield-tech"
              readOnly={isEdit}
              className={isEdit ? "opacity-60" : undefined}
              {...register("slug", {
                validate: (val) =>
                  isEdit ||
                  SLUG_RE.test(val.trim().toLowerCase()) ||
                  "Use lowercase letters, numbers and single hyphens",
              })}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Contact email" error={errors.contactEmail?.message}>
              <Input
                type="email"
                placeholder="admin@college.edu"
                {...register("contactEmail")}
              />
            </FormField>
            <FormField label="Contact phone">
              <Input placeholder="+91 …" {...register("contactPhone")} />
            </FormField>
          </div>

          <FormField label="Status">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CollegeStatus.ACTIVE}>Active</SelectItem>
                    <SelectItem value={CollegeStatus.SUSPENDED}>
                      Suspended
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
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
              {isEdit ? "Save changes" : "Create college"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
