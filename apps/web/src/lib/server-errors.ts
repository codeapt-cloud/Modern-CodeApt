/**
 * Maps a server error onto a react-hook-form. Field-level errors (from the
 * server's `details.fields` or a known AuthErrorCode) are attached to the
 * matching field; anything else is returned as a form-level message.
 */
import { AuthErrorCode } from "@codeapt/shared";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { parseApiError } from "./api-client.js";

const CODE_TO_FIELD: Partial<Record<string, string>> = {
  [AuthErrorCode.EMAIL_TAKEN]: "email",
  [AuthErrorCode.USERNAME_TAKEN]: "username",
  [AuthErrorCode.ROLL_NUMBER_TAKEN]: "rollNumber",
};

export function mapServerErrorToForm<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
): string {
  const parsed = parseApiError(err);

  // Explicit field errors from the server.
  if (parsed.fields && Object.keys(parsed.fields).length > 0) {
    for (const [field, message] of Object.entries(parsed.fields)) {
      // Server field names mirror the form field names for these forms.
      setError(field as Path<T>, { type: "server", message });
    }
    return "";
  }

  // Code-driven single-field mapping.
  const field = parsed.code ? CODE_TO_FIELD[parsed.code] : undefined;
  if (field) {
    setError(field as Path<T>, { type: "server", message: parsed.message });
    return "";
  }

  // Otherwise, a form-level message.
  return parsed.message;
}
