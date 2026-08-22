/**
 * Admin posting editor (Dialog) — create or edit a posting. Mirrors the form
 * pattern used across the app (FormField + design-system controls, RHF).
 * The form works over a flat shape (dates as yyyy-mm-dd, optional text as "")
 * and transforms to the shared `AdminPostingUpsert` on submit, which the server
 * re-validates. A posting WITH an applyUrl is external-apply; WITHOUT one it
 * uses the in-app application flow.
 */
import {
  POSTING_TYPE_VALUES,
  PostingType,
  type AdminPosting,
  type OrgUnitTreeNode,
  type PostingType as PostingTypeT,
  type Role,
  type UploadSignatureResponse,
} from "@codeapt/shared";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";

import { api, parseApiError } from "../../lib/api-client.js";
import {
  type PostingAuthoringApi,
  type PostingAuthoringBody,
} from "../../lib/careers-authoring-api.js";
import { postingTypeLabel } from "../../lib/careers-ui.js";
import { canTarget } from "../../lib/exam-targeting.js";
import { OrgUnitTargetPicker } from "../colleges/exams/OrgUnitTargetPicker.js";
import { ImageUpload } from "../media/ImageUpload.js";
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
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";
import { useToast } from "../ui/toast.js";

interface PostingFormValues {
  title: string;
  company: string;
  companyLogo: string;
  location: string;
  type: PostingTypeT;
  compensation: string;
  description: string;
  requirements: string;
  applyUrl: string;
  deadline: string; // yyyy-mm-dd or ""
  isActive: boolean;
  orgUnitIds: string[];
}

function toDefaults(
  posting: AdminPosting | null,
  initialOrgUnitIds: string[],
): PostingFormValues {
  return {
    title: posting?.title ?? "",
    company: posting?.company ?? "",
    companyLogo: posting?.companyLogo ?? "",
    location: posting?.location ?? "",
    type: posting?.type ?? PostingType.FULL_TIME,
    compensation: posting?.compensation ?? "",
    description: posting?.description ?? "",
    requirements: posting?.requirements ?? "",
    applyUrl: posting?.applyUrl ?? "",
    deadline: posting?.deadline ? posting.deadline.slice(0, 10) : "",
    isActive: posting?.isActive ?? true,
    orgUnitIds: initialOrgUnitIds,
  };
}

function toPayload(
  values: PostingFormValues,
  withTargeting: boolean,
): PostingAuthoringBody {
  return {
    title: values.title.trim(),
    company: values.company.trim(),
    companyLogo: values.companyLogo.trim(),
    location: values.location.trim(),
    type: values.type,
    compensation: values.compensation.trim(),
    description: values.description,
    requirements: values.requirements,
    applyUrl: values.applyUrl.trim(),
    // A bare date → end-of-day UTC so "apply by the 5th" includes the 5th.
    deadline: values.deadline
      ? new Date(`${values.deadline}T23:59:59.000Z`).toISOString()
      : null,
    isActive: values.isActive,
    // Org-unit targeting is included only in college mode (targeting present).
    ...(withTargeting ? { orgUnitIds: values.orgUnitIds } : {}),
  };
}

/** College targeting mode — supplied only by the college surface. */
export interface PostingTargeting {
  tree: OrgUnitTreeNode[];
  role: Role;
  /** The posting's current target units (empty = college-wide). */
  initialOrgUnitIds: string[];
}

export interface PostingEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; an AdminPosting → edit. */
  initial: AdminPosting | null;
  onSaved: () => void;
  /** Authoring backend — defaults to the platform admin api; the college editor
   * injects a slug-bound tenant adapter. */
  authApi?: PostingAuthoringApi;
  /** When set, renders org-unit targeting and includes orgUnitIds in the payload
   * (college mode). Omitted for the platform admin (no targeting). */
  targeting?: PostingTargeting;
  /** How the company-logo upload obtains its Cloudinary signature. Omitted on
   * the platform-admin surface (ImageUpload defaults to the admin endpoint); the
   * college surface injects a tenant-scoped fetcher so faculty aren't 403'd. */
  signatureFetcher?: () => Promise<UploadSignatureResponse>;
}

export function PostingEditorDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
  authApi = api.adminCareers,
  targeting,
  signatureFetcher,
}: PostingEditorDialogProps) {
  const { toast } = useToast();
  const [formError, setFormError] = useState("");
  const isAdminRole =
    targeting?.role === "college_admin" || targeting?.role === "super_admin";
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PostingFormValues>({
    defaultValues: toDefaults(initial, targeting?.initialOrgUnitIds ?? []),
  });
  const orgUnitIds = watch("orgUnitIds");

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    if (targeting && !canTarget(values.orgUnitIds, isAdminRole)) {
      setFormError("Pick at least one target section within your scope.");
      return;
    }
    const payload = toPayload(values, targeting !== undefined);
    try {
      if (initial) {
        await authApi.update(initial.id, payload);
      } else {
        await authApi.create(payload);
      }
      toast({
        variant: "success",
        title: initial ? "Posting updated" : "Posting created",
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setFormError(parseApiError(err).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Edit posting" : "New posting"}
          </DialogTitle>
          <DialogDescription>
            Leave the apply URL blank to collect applications in-app; set it to
            redirect applicants to a company site.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Title" required error={errors.title?.message}>
              <Input
                {...register("title", { required: "Title is required" })}
              />
            </FormField>
            <FormField label="Company" required error={errors.company?.message}>
              <Input
                {...register("company", { required: "Company is required" })}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Type">
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POSTING_TYPE_VALUES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {postingTypeLabel(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField label="Location">
              <Input placeholder="Remote · Bengaluru" {...register("location")} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Compensation" hint="Free text (e.g. ₹12 LPA).">
              <Input placeholder="₹12 LPA" {...register("compensation")} />
            </FormField>
            <FormField label="Deadline" hint="Leave blank for no deadline.">
              <Input type="date" {...register("deadline")} />
            </FormField>
          </div>

          <FormField
            label="Company logo"
            hint="Upload to Cloudinary, or paste an existing image URL."
            error={errors.companyLogo?.message}
          >
            <Controller
              control={control}
              name="companyLogo"
              render={({ field }) => (
                <ImageUpload
                  value={field.value}
                  onChange={field.onChange}
                  signatureFetcher={signatureFetcher}
                />
              )}
            />
          </FormField>

          <FormField
            label="Apply URL"
            hint="Blank = in-app applications. Set = external apply link."
            error={errors.applyUrl?.message}
          >
            <Input
              type="url"
              placeholder="https://company.example/careers/123"
              {...register("applyUrl")}
            />
          </FormField>

          <FormField label="Description" hint="Markdown supported.">
            <Textarea rows={5} {...register("description")} />
          </FormField>

          <FormField label="Requirements" hint="Markdown supported.">
            <Textarea rows={4} {...register("requirements")} />
          </FormField>

          {targeting ? (
            <FormField
              label="Target cohorts"
              hint={
                isAdminRole
                  ? "Leave empty for the whole college, or pick specific sections."
                  : "Pick the section(s) this posting is for (within your scope)."
              }
            >
              <Controller
                control={control}
                name="orgUnitIds"
                render={({ field }) => (
                  <OrgUnitTargetPicker
                    tree={targeting.tree}
                    value={field.value}
                    onChange={field.onChange}
                    role={targeting.role}
                  />
                )}
              />
            </FormField>
          ) : null}

          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <label className="flex items-center gap-3">
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
                <span className="text-sm text-ink">
                  {targeting
                    ? "Open for applications"
                    : "Published (visible to students)"}
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
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={
                targeting ? !canTarget(orgUnitIds ?? [], isAdminRole) : false
              }
            >
              {initial ? "Save changes" : "Create posting"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
