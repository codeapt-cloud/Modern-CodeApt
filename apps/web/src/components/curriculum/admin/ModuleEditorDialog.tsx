/**
 * Module create/edit dialog. A module is a named, ordered group of topics under
 * a subject. Topics themselves are authored in 4b-ii.
 */
import type { AdminModule, AdminModuleUpsert } from "@codeapt/shared";
import { useForm } from "react-hook-form";
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
import { useToast } from "../../ui/toast.js";

interface ModuleFormValues {
  name: string;
  order: number;
}

export interface ModuleEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectId: string;
  /** null → create; an AdminModule → edit. */
  initial: AdminModule | null;
  /** Order to pre-fill on create (append at end). */
  nextOrder?: number;
  onSaved: () => void;
}

export function ModuleEditorDialog({
  open,
  onOpenChange,
  subjectId,
  initial,
  nextOrder = 0,
  onSaved,
}: ModuleEditorDialogProps) {
  const { toast } = useToast();
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ModuleFormValues>({
    defaultValues: {
      name: initial?.name ?? "",
      order: initial?.order ?? nextOrder,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    const payload: AdminModuleUpsert = {
      name: values.name.trim(),
      order: Math.max(0, Math.trunc(values.order) || 0),
    };
    try {
      if (initial) {
        await api.adminCurriculum.modules.update(initial.id, payload);
      } else {
        await api.adminCurriculum.modules.create(subjectId, payload);
      }
      toast({
        variant: "success",
        title: initial ? "Module updated" : "Module created",
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setFormError(parseApiError(err).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit module" : "New module"}</DialogTitle>
          <DialogDescription>
            A module groups topics within a course.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <FormField label="Name" required error={errors.name?.message}>
            <Input
              placeholder="Arrays & Strings"
              {...register("name", { required: "Name is required" })}
            />
          </FormField>

          <FormField label="Order" hint="Lower numbers sort first.">
            <Input
              type="number"
              min={0}
              {...register("order", { valueAsNumber: true })}
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
              {initial ? "Save changes" : "Create module"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
