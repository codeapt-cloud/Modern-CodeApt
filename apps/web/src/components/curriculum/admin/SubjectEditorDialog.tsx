/**
 * Subject (course) create/edit dialog with ALL fields. Prices are entered in
 * rupees and converted to integer paise on submit (storage is paise). The
 * program is assignable and nullable. `image` is stored as a URL string,
 * populated by the Cloudinary signed-upload control (a pasted URL still works
 * for backward-compat). Slug is optional (auto-derived); SLUG_TAKEN and other
 * server errors surface inline.
 */
import type { AdminSubject, AdminSubjectUpsert } from "@codeapt/shared";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";

import { ImageUpload } from "../../media/ImageUpload.js";

import { api, parseApiError } from "../../../lib/api-client.js";
import {
  paiseToRupeeInput,
  rupeesToPaise,
} from "../../../lib/curriculum-admin-ui.js";
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
import { FormField } from "../../ui/form-field.js";
import { Input } from "../../ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";
import { useToast } from "../../ui/toast.js";

/** Radix Select forbids an empty-string item value, so "unfiled" gets a token. */
const NO_PROGRAM = "__none__";

interface SubjectFormValues {
  name: string;
  slug: string;
  programId: string; // "" = unfiled
  image: string;
  description: string;
  priceRupees: number;
  discountRupees: number;
  isPopular: boolean;
  isVisible: boolean;
}

function toDefaults(subject: AdminSubject | null): SubjectFormValues {
  return {
    name: subject?.name ?? "",
    slug: subject?.slug ?? "",
    programId: subject?.programId ?? "",
    image: subject?.image ?? "",
    description: subject?.description ?? "",
    priceRupees: subject ? paiseToRupeeInput(subject.price) : 0,
    discountRupees: subject ? paiseToRupeeInput(subject.discountPrice) : 0,
    isPopular: subject?.isPopular ?? false,
    isVisible: subject?.isVisible ?? true,
  };
}

function toPayload(values: SubjectFormValues): AdminSubjectUpsert {
  const slug = values.slug.trim();
  const image = values.image.trim();
  return {
    name: values.name.trim(),
    ...(slug ? { slug } : {}),
    programId: values.programId ? values.programId : null,
    image,
    description: values.description,
    price: rupeesToPaise(values.priceRupees),
    discountPrice: rupeesToPaise(values.discountRupees),
    isPopular: values.isPopular,
    isVisible: values.isVisible,
  };
}

export interface SubjectEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; an AdminSubject → edit. */
  initial: AdminSubject | null;
  /** Pre-select this program on create (e.g. opened under a program row). */
  defaultProgramId?: string | null;
  onSaved: (subject: AdminSubject) => void;
}

export function SubjectEditorDialog({
  open,
  onOpenChange,
  initial,
  defaultProgramId,
  onSaved,
}: SubjectEditorDialogProps) {
  const { toast } = useToast();
  const [formError, setFormError] = useState("");
  const { data: programsData } = useQuery(
    () => api.adminCurriculum.programs.list(),
    [],
  );
  const programs = programsData?.items ?? [];

  const defaults = toDefaults(initial);
  if (!initial && defaultProgramId) defaults.programId = defaultProgramId;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SubjectFormValues>({ defaultValues: defaults });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    const payload = toPayload(values);
    try {
      const saved = initial
        ? await api.adminCurriculum.subjects.update(initial.id, payload)
        : await api.adminCurriculum.subjects.create(payload);
      toast({
        variant: "success",
        title: initial ? "Course updated" : "Course created",
      });
      onOpenChange(false);
      onSaved(saved);
    } catch (err) {
      setFormError(parseApiError(err).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit course" : "New course"}</DialogTitle>
          <DialogDescription>
            Prices are in rupees and stored to the paisa. Leave a price at 0 to
            make the course free.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" required error={errors.name?.message}>
              <Input {...register("name", { required: "Name is required" })} />
            </FormField>
            <FormField
              label="Slug"
              hint="Leave blank to auto-generate."
              error={errors.slug?.message}
            >
              <Input placeholder="data-structures" {...register("slug")} />
            </FormField>
          </div>

          <FormField label="Program" hint="Group this course under a program.">
            <Controller
              control={control}
              name="programId"
              render={({ field }) => (
                <Select
                  value={field.value ? field.value : NO_PROGRAM}
                  onValueChange={(v) =>
                    field.onChange(v === NO_PROGRAM ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROGRAM}>
                      No program (unfiled)
                    </SelectItem>
                    {programs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Price (₹)"
              hint="List price in rupees."
              error={errors.priceRupees?.message}
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                {...register("priceRupees", { valueAsNumber: true })}
              />
            </FormField>
            <FormField
              label="Discount price (₹)"
              hint="0 = no discount. Must be below the price to apply."
              error={errors.discountRupees?.message}
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                {...register("discountRupees", { valueAsNumber: true })}
              />
            </FormField>
          </div>

          <FormField
            label="Course image"
            hint="Upload to Cloudinary, or paste an existing image URL."
            error={errors.image?.message}
          >
            <Controller
              control={control}
              name="image"
              render={({ field }) => (
                <ImageUpload value={field.value} onChange={field.onChange} />
              )}
            />
          </FormField>

          <FormField label="Description" hint="Markdown supported.">
            <Textarea rows={4} {...register("description")} />
          </FormField>

          <div className="flex flex-wrap gap-6">
            <Controller
              control={control}
              name="isPopular"
              render={({ field }) => (
                <label className="flex items-center gap-3">
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <span className="text-sm text-ink">Popular (featured)</span>
                </label>
              )}
            />
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
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {initial ? "Save changes" : "Create course"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
