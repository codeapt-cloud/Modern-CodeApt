/**
 * Public (pre-auth) controllers — no authentication, no tenant context. These
 * expose ONLY explicitly-public data. Today: a college's login-page branding by
 * slug, used to skin /c/:slug/login before the visitor has logged in.
 */
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import { getPublicBranding } from "../services/college.service.js";

export const getPublicCollegeBrandingController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await getPublicBranding(req.params.slug ?? ""));
  },
);
