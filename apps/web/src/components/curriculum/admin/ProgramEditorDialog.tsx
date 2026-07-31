/**
 * Program create/edit dialog. Mirrors the app's RHF + design-system form
 * pattern (see PostingEditorDialog). Slug is optional — left blank, the server
 * derives it from the name; a SLUG_TAKEN 409 surfaces inline.
 */
import type { AdminProgram, AdminProgramUpsert } from "@codeapt/shared";
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
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";
import { useToast } from "../../ui/toast.js";

interface ProgramFormValues {
  name: string;
  slug: string;
  description: string;
  order: number;
  isVisible: boolean;
}

function toDefaults(program: AdminProgram | null): ProgramFormValues {
  return {
    name: program?.name ?? "",
    slug: program?.slug ?? "",
    description: program?.description ?? "",
    order: program?.order ?? 0,
    isVisible: program?.isVisible ?? true,
  };
}

function toPayload(values: ProgramFormValues): AdminProgramUpsert {
  const slug = values.slug.trim();
  return {
    name: values.name.trim(),
    // Omit when blank so the server auto-derives (an empty string fails the
    // slug regex).
    ...(slug ? { slug } : {}),
    description: values.description,
    order: Math.max(0, Math.trunc(values.order) || 0),
    isVisible: values.isVisible,
  };
}

export interface ProgramEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; an AdminProgram → edit. */
  initial: AdminProgram | null;
  onSaved: () => void;
}

export function ProgramEditorDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: ProgramEditorDialogProps) {
  const { toast } = useToast();
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ProgramFormValues>({ defaultValues: toDefaults(initial) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    const payload = toPayload(values);
    try {
      if (initial) {
        await api.adminCurriculum.programs.update(initial.id, payload);
      } else {
        await api.adminCurriculum.programs.create(payload);
      }
      toast({
        variant: "success",
        title: initial ? "Program updated" : "Program created",
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setFormError(parseApiError(err).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit program" : "New program"}</DialogTitle>
          <DialogDescription>
            Programs group related courses (e.g. “Campus Placement Prep”).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <FormField label="Name" required error={errors.name?.message}>
            <Input {...register("name", { required: "Name is required" })} />
          </FormField>

          <FormField
            label="Slug"
            hint="URL identifier. Leave blank to auto-generate from the name."
            error={errors.slug?.message}
          >
            <Input placeholder="campus-placement-prep" {...register("slug")} />
          </FormField>

          <FormField label="Description">
            <Textarea rows={3} {...register("description")} />
          </FormField>

          <FormField label="Order" hint="Lower numbers sort first.">
            <Input
              type="number"
              min={0}
              {...register("order", { valueAsNumber: true })}
            />
          </FormField>

          <Controller
            control={control}
            name="isVisible"
            render={({ field }) => (
              <label className="flex items-center gap-3">
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
                <span className="text-sm text-ink">
                  Visible (shown in the catalog)
                </span>
              </label>
            )}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {initial ? "Save changes" : "Create program"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
