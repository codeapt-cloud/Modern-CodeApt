import {
  AuthErrorCode,
  changePasswordSchema,
  type ChangePasswordInput,
} from "@codeapt/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { FormField } from "../../components/ui/form-field.js";
import { Input } from "../../components/ui/input.js";
import { parseApiError } from "../../lib/api-client.js";
import { useAuth } from "../../providers/AuthProvider.js";

/** Reused by both the voluntary and forced change-password screens. */
export function ChangePasswordForm({
  submitLabel = "Update password",
  onSuccess,
}: {
  submitLabel?: string;
  onSuccess: () => void;
}) {
  const { changePassword } = useAuth();
  const [formError, setFormError] = useState("");

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      await changePassword(values);
      onSuccess();
    } catch (err) {
      const parsed = parseApiError(err);
      // A wrong current password comes back as INVALID_CREDENTIALS.
      if (parsed.code === AuthErrorCode.INVALID_CREDENTIALS) {
        setError("currentPassword", {
          type: "server",
          message: parsed.message,
        });
      } else {
        setFormError(parsed.message);
      }
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {formError ? <Alert variant="error">{formError}</Alert> : null}

      <FormField
        label="Current password"
        error={errors.currentPassword?.message}
      >
        <Input
          type="password"
          autoComplete="current-password"
          {...register("currentPassword")}
        />
      </FormField>

      <FormField
        label="New password"
        error={errors.newPassword?.message}
        hint="At least 8 characters, mixing letters and a digit."
      >
        <Input
          type="password"
          autoComplete="new-password"
          {...register("newPassword")}
        />
      </FormField>

      <FormField
        label="Confirm new password"
        error={errors.confirmPassword?.message}
      >
        <Input
          type="password"
          autoComplete="new-password"
          {...register("confirmPassword")}
        />
      </FormField>

      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
