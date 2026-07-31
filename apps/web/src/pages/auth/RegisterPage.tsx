import { registerSchema, type RegisterInput } from "@codeapt/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { FormField } from "../../components/ui/form-field.js";
import { Input } from "../../components/ui/input.js";
import { useToast } from "../../components/ui/toast.js";
import { mapServerErrorToForm } from "../../lib/server-errors.js";
import { useAuth } from "../../providers/AuthProvider.js";
import { AuthLayout } from "./AuthLayout.js";

export function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [formError, setFormError] = useState("");

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      await registerUser(values);
      toast({
        variant: "success",
        title: "Account created",
        description: "Log in with your new credentials to continue.",
      });
      navigate("/login", { replace: true });
    } catch (err) {
      setFormError(mapServerErrorToForm<RegisterInput>(err, setError));
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join CodeApt and start preparing for placements."
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-medium text-primary hover:underline"
          >
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <FormField label="Full name" required error={errors.fullName?.message}>
          <Input
            autoComplete="name"
            placeholder="Ada Lovelace"
            {...register("fullName")}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Username" required error={errors.username?.message}>
            <Input
              autoComplete="username"
              placeholder="ada"
              {...register("username")}
            />
          </FormField>
          <FormField label="Email" required error={errors.email?.message}>
            <Input
              type="email"
              autoComplete="email"
              placeholder="ada@example.com"
              {...register("email")}
            />
          </FormField>
        </div>

        <FormField
          label="Password"
          required
          error={errors.password?.message}
          hint="At least 8 characters, with upper- and lower-case letters and a digit."
        >
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            {...register("password")}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Roll number"
            required
            error={errors.rollNumber?.message}
          >
            <Input placeholder="CS-2025-001" {...register("rollNumber")} />
          </FormField>
          <FormField
            label="Phone number"
            required
            error={errors.phoneNumber?.message}
          >
            <Input
              type="tel"
              autoComplete="tel"
              placeholder="9876543210"
              {...register("phoneNumber")}
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="College"
            required
            error={errors.collegeName?.message}
          >
            <Input
              placeholder="Acme Institute of Tech"
              {...register("collegeName")}
            />
          </FormField>
          <FormField label="State" required error={errors.state?.message}>
            <Input placeholder="Karnataka" {...register("state")} />
          </FormField>
        </div>

        <Button
          type="submit"
          className="w-full"
          size="lg"
          loading={isSubmitting}
        >
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
