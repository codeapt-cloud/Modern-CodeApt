/**
 * The login FORM — the single source of the login credentials + submit + post-
 * login redirect. Shared by the generic LoginPage and the per-college branded
 * login page, so auth logic lives in exactly one place: on success it navigates
 * to "/" (a deliberate `from` deep-link wins), and RootRoute + homePathForUser
 * route each user to their correct home — UNCHANGED by branding.
 */
import { loginSchema, type LoginInput } from "@codeapt/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { FormField } from "../../components/ui/form-field.js";
import { Input } from "../../components/ui/input.js";
import { mapServerErrorToForm } from "../../lib/server-errors.js";
import { useAuth } from "../../providers/AuthProvider.js";

interface LocationState {
  from?: { pathname?: string };
}

export function LoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState("");

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      const res = await login(values);
      const from = (location.state as LocationState | null)?.from?.pathname;
      // Land at "/" so RootRoute routes a college operator to their workspace and
      // everyone else to the learner app. A deliberate `from` deep-link wins.
      navigate(
        res.user.forcePasswordChange ? "/forced-password-change" : (from ?? "/"),
        { replace: true },
      );
    } catch (err) {
      setFormError(mapServerErrorToForm<LoginInput>(err, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {formError ? <Alert variant="error">{formError}</Alert> : null}

      <FormField label="Username or email" error={errors.identifier?.message}>
        <Input
          autoComplete="username"
          placeholder="you@example.com"
          {...register("identifier")}
        />
      </FormField>

      <FormField label="Password" error={errors.password?.message}>
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          {...register("password")}
        />
      </FormField>

      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
        Log in
      </Button>
    </form>
  );
}
