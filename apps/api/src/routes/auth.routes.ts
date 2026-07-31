import { Router } from "express";

import {
  changePasswordController,
  loginController,
  logoutController,
  refreshController,
  registerController,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import { authRateLimiter } from "../middleware/rate-limit.js";

export const authRouter: Router = Router();

// Rate-limited, unauthenticated endpoints.
authRouter.post("/auth/register", authRateLimiter, registerController);
authRouter.post("/auth/login", authRateLimiter, loginController);
authRouter.post("/auth/refresh", authRateLimiter, refreshController);

// Logout is safe to call unauthenticated (idempotent cookie clear).
authRouter.post("/auth/logout", logoutController);

// Authenticated, but intentionally NOT behind enforcePasswordChange so a user
// with forcePasswordChange set can still reach it.
authRouter.post("/auth/change-password", requireAuth, changePasswordController);
