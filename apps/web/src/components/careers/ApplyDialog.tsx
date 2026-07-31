/**
 * In-app application form (Dialog) for postings WITHOUT an applyUrl. The fields
 * are pre-filled from the student's profile but are a COPY — editing them for
 * this application never touches the profile. Client validation mirrors the
 * shared `applyRequestSchema`; the server re-checks the open/deadline gate and
 * apply-once idempotency, and this surfaces each documented rejection.
 */
import {
  CareerErrorCode,
  applyRequestSchema,
  type ApplyRequest,
} from "@codeapt/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { api, parseApiError } from "../../lib/api-client.js";
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
import { Textarea } from "../ui/textarea.js";
import { useToast } from "../ui/toast.js";

export interface ApplyDialogProps {
  postingId: string;
  postingTitle: string;
  /** When set, apply through the tenant endpoint (a college posting). */
  collegeSlug?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Profile-derived defaults (a copy — never written back to the profile). */
  defaults: { fullName: string; email: string; phone: string };
  /** Called after any terminal outcome so the page can refetch the posting. */
  onResolved: () => void;
}

export function ApplyDialog({
  postingId,
  postingTitle,
  collegeSlug,
  open,
  onOpenChange,
  defaults,
  onResolved,
}: ApplyDialogProps) {
  const { toast } = useToast();
  const [formError, setFormError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ApplyRequest>({
    resolver: zodResolver(applyRequestSchema),
    defaultValues: {
      fullName: defaults.fullName,
      email: defaults.email,
      phone: defaults.phone,
      resumeUrl: "",
      coverLetter: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      if (collegeSlug) {
        await api.collegeCareers.studentApply(collegeSlug, postingId, values);
      } else {
        await api.careers.apply(postingId, values);
      }
      toast({ variant: "success", title: "Application submitted" });
      onOpenChange(false);
      onResolved();
    } catch (err) {
      const parsed = parseApiError(err);
      switch (parsed.code) {
        case CareerErrorCode.ALREADY_APPLIED:
          toast({ variant: "info", title: "You've already applied" });
          onOpenChange(false);
          onResolved();
          break;
        case CareerErrorCode.DEADLINE_PASSED:
        case CareerErrorCode.POSTING_CLOSED:
          toast({
            variant: "warning",
            title: "Applications are closed for this posting",
          });
          onOpenChange(false);
          onResolved();
          break;
        case CareerErrorCode.POSTING_NOT_FOUND:
          toast({ variant: "error", title: "This posting is no longer available" });
          onOpenChange(false);
          onResolved();
          break;
        default:
          setFormError(parsed.message);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply — {postingTitle}</DialogTitle>
          <DialogDescription>
            We&apos;ve pre-filled your details. Edit them for this application if
            needed; your profile stays unchanged.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <FormField label="Full name" required error={errors.fullName?.message}>
            <Input autoComplete="name" {...register("fullName")} />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Email" required error={errors.email?.message}>
              <Input type="email" autoComplete="email" {...register("email")} />
            </FormField>
            <FormField label="Phone" error={errors.phone?.message}>
              <Input autoComplete="tel" {...register("phone")} />
            </FormField>
          </div>

          <FormField
            label="Resume URL"
            hint="Link to your resume (PDF/Drive)."
            error={errors.resumeUrl?.message}
          >
            <Input
              type="url"
              placeholder="https://…"
              {...register("resumeUrl")}
            />
          </FormField>

          <FormField label="Cover letter" error={errors.coverLetter?.message}>
            <Textarea
              rows={5}
              placeholder="Why you're a great fit (optional)…"
              {...register("coverLetter")}
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
              Submit application
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
