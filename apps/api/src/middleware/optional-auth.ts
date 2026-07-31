/**
 * optionalAuth — like requireAuth, but never rejects. If a valid access token
 * is present it populates `req.auth`; otherwise it silently continues. Used by
 * public-but-personalizable routes (catalog, subject browse) so responses can
 * include per-user flags (e.g. isEnrolled) when the caller is signed in.
 */
import { type Role, type UserType } from "@codeapt/shared";
import type { Request, RequestHandler } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import { ACCESS_COOKIE } from "../lib/cookies.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { UserModel } from "../models/user.model.js";

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[
    ACCESS_COOKIE
  ];
  return cookieToken ?? null;
}

export const optionalAuth: RequestHandler = asyncHandler(
  async (req, _res, next) => {
    const token = extractToken(req);
    if (!token) return next();

    try {
      const claims = verifyAccessToken(token);
      const user = await UserModel.findById(claims.sub).select(
        "role isActive forcePasswordChange tokenVersion userType college",
      );
      if (user && user.isActive && user.tokenVersion === claims.tokenVersion) {
        req.auth = {
          userId: user._id.toString(),
          role: user.role as Role,
          forcePasswordChange: user.forcePasswordChange,
          userType: user.userType as UserType,
          college: user.college ? user.college.toString() : null,
        };
      }
    } catch {
      // Invalid/expired token on an optional route — treat as anonymous.
    }
    next();
  },
);
