/**
 * enforcePasswordChange — when `forcePasswordChange` is set, blocks protected
 * routes with a machine-readable code the UI acts on (route to change-password).
 *
 * Mount AFTER requireAuth on protected routers. The change-password and logout
 * endpoints live under /api/auth and simply don't mount this guard, so they
 * remain reachable.
 */
import { AuthErrorCode } from "@codeapt/shared";
import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error.js";

export const enforcePasswordChange: RequestHandler = (req, _res, next) => {
  if (req.auth?.forcePasswordChange) {
    throw new AppError(
      "You must change your password before continuing",
      403,
      AuthErrorCode.FORCE_PASSWORD_CHANGE,
    );
  }
  next();
};
