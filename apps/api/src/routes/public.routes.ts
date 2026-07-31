/**
 * PUBLIC routes — no auth, no tenant stack. Everything here is safe to serve to
 * an anonymous visitor. Keep this router tiny and audited: only explicitly
 * public data belongs here.
 *
 * `GET /public/colleges/:slug/branding` — a college's login-page branding
 * (logo / display name / welcome / accent), so /c/:slug/login can render its
 * skin before the visitor logs in. Never exposes members, entitlements, or
 * contacts. 404 for an unknown slug.
 */
import { Router } from "express";

import { getPublicCollegeBrandingController } from "../controllers/public.controller.js";

export const publicRouter: Router = Router();

publicRouter.get(
  "/public/colleges/:slug/branding",
  getPublicCollegeBrandingController,
);
