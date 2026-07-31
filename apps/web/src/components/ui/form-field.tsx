import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "../../lib/cn.js";
import { Label } from "./label.js";

export interface FormFieldProps {
  label?: ReactNode;
  /** Error message (e.g. from a zod/react-hook-form field error). */
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  /** A single form control (Input/Textarea/Select trigger, …). */
  children: ReactNode;
}

// Props the field control receives so label/hint/error are wired for a11y.
interface InjectedProps {
  id: string;
  invalid?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/**
 * Wraps a control with its label, hint, and error, auto-wiring `id`,
 * `aria-invalid`, and `aria-describedby` onto the control (via cloneElement),
 * so callers using react-hook-form don't repeat that plumbing.
 */
export function FormField({
  label,
  error,
  hint,
  required,
  className,
  children,
}: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  // cloneElement lets FormField own accessibility wiring; the control only
  // needs to accept these standard props (all our inputs do).
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<InjectedProps>, {
        id,
        // Inject `invalid` ONLY when there's an error. Passing `invalid={false}`
        // leaks a non-boolean attribute onto plain-element children (e.g. a
        // wrapper <div> around a multi-select/checkbox list) and React warns;
        // `undefined` is omitted from the DOM. Our controls treat absence as
        // not-invalid.
        invalid: error ? true : undefined,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })
    : children;

  return (
    <div className={cn("grid gap-1.5", className)}>
      {label ? (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      ) : null}
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          className="text-xs font-medium text-error-fg"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
