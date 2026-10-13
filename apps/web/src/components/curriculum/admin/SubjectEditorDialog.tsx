/**
 * Subject (course) create/edit dialog with ALL fields. Prices are entered in
 * rupees and converted to integer paise on submit (storage is paise). The
 * program is assignable and nullable. `image` is stored as a URL string,
 * populated by the Cloudinary signed-upload control (a pasted URL still works
 * for backward-compat). Slug is optional (auto-derived); SLUG_TAKEN and other
 * server errors surface inline.
 */
import type { AdminSubject, AdminSubjectUpsert } from "@codeapt/shared";
import { Eye, List, ListOrdered, PenLine, Quote } from "lucide-react";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { ImageUpload } from "../../media/ImageUpload.js";
import { Markdown } from "../../player/Markdown.js";

import { api, parseApiError } from "../../../lib/api-client.js";
import { cn } from "../../../lib/cn.js";
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
  validityDays: number;
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
    validityDays: subject?.validityDays ?? 0,
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
    validityDays: Math.max(0, Math.trunc(values.validityDays) || 0),
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

  const [descTab, setDescTab] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SubjectFormValues>({ defaultValues: defaults });

  const descriptionValue = watch("description") || "";

  const insertFormatting = (prefix: string, suffix = "", placeholder = "") => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const current = el.value || "";
    const selected = current.slice(start, end) || placeholder;
    const next =
      current.slice(0, start) + prefix + selected + suffix + current.slice(end);
    setValue("description", next, { shouldDirty: true, shouldValidate: true });
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selected.length,
      );
    }, 0);
  };

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
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-2xl overflow-y-auto">
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
            label="Access validity (days)"
            hint="0 = lifetime access. Otherwise access ends this many days after each learner enrols."
            error={errors.validityDays?.message}
          >
            <Input
              type="number"
              min={0}
              step="1"
              {...register("validityDays", { valueAsNumber: true })}
            />
          </FormField>

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

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <label className="text-sm font-medium text-ink">Description</label>
                <p className="text-xs text-ink-muted">
                  Markdown supported — use **bold**, bullet points, and headings.
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-subtle bg-surface-base p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setDescTab("write")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors",
                    descTab === "write"
                      ? "bg-surface-overlay text-ink shadow-sm"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  <PenLine className="h-3.5 w-3.5" />
                  Write
                </button>
                <button
                  type="button"
                  onClick={() => setDescTab("preview")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors",
                    descTab === "preview"
                      ? "bg-surface-overlay text-ink shadow-sm"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </button>
              </div>
            </div>

            {descTab === "write" ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1 rounded-lg border border-subtle bg-surface-overlay/40 p-1 text-xs">
                  <button
                    type="button"
                    title="Bold (**text**)"
                    onClick={() => insertFormatting("**", "**", "bold text")}
                    className="flex h-7 items-center justify-center rounded px-2 font-bold text-ink hover:bg-surface-overlay active:bg-surface-muted"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    title="Italic (*text*)"
                    onClick={() => insertFormatting("*", "*", "italic text")}
                    className="flex h-7 items-center justify-center rounded px-2 italic text-ink hover:bg-surface-overlay active:bg-surface-muted"
                  >
                    I
                  </button>
                  <button
                    type="button"
                    title="Heading (### Section)"
                    onClick={() => insertFormatting("### ", "\n", "Heading")}
                    className="flex h-7 items-center justify-center rounded px-2 font-mono font-semibold text-ink hover:bg-surface-overlay active:bg-surface-muted"
                  >
                    H3
                  </button>
                  <div className="mx-1 h-4 w-px bg-subtle" />
                  <button
                    type="button"
                    title="Bullet List (- item)"
                    onClick={() => insertFormatting("- ", "\n", "List item")}
                    className="flex h-7 items-center gap-1 rounded px-2 text-ink hover:bg-surface-overlay active:bg-surface-muted"
                  >
                    <List className="h-3.5 w-3.5" />
                    List
                  </button>
                  <button
                    type="button"
                    title="Numbered List (1. item)"
                    onClick={() => insertFormatting("1. ", "\n", "List item")}
                    className="flex h-7 items-center gap-1 rounded px-2 text-ink hover:bg-surface-overlay active:bg-surface-muted"
                  >
                    <ListOrdered className="h-3.5 w-3.5" />
                    1. List
                  </button>
                  <button
                    type="button"
                    title="Quote (> quote)"
                    onClick={() => insertFormatting("> ", "\n", "Quote")}
                    className="flex h-7 items-center gap-1 rounded px-2 text-ink hover:bg-surface-overlay active:bg-surface-muted"
                  >
                    <Quote className="h-3.5 w-3.5" />
                    Quote
                  </button>
                </div>
                <Textarea
                  rows={6}
                  {...register("description")}
                  ref={(e) => {
                    register("description").ref(e);
                    textareaRef.current = e;
                  }}
                  placeholder="e.g.&#10;**Course Highlights:**&#10;- Foundation & Advanced practice&#10;- Live mentoring & video solutions&#10;&#10;### Who this course is for&#10;- Students preparing for recruitment drives"
                  className="font-mono text-xs leading-relaxed sm:text-sm"
                />
              </div>
            ) : (
              <div className="min-h-[160px] max-h-[280px] overflow-y-auto rounded-xl border border-subtle bg-surface-sunken/40 p-4 text-sm text-ink">
                {descriptionValue ? (
                  <Markdown content={descriptionValue} className="text-sm" />
                ) : (
                  <p className="italic text-ink-muted">
                    No description entered yet. Switch to the Write tab to type.
                  </p>
                )}
              </div>
            )}
          </div>

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
