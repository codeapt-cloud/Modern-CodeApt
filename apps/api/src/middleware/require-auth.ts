/**
 * requireAuth — verifies the access token (Bearer header OR httpOnly cookie),
 * checks the user is active and the token isn't revoked (tokenVersion), then
 * populates `req.auth`.
 */
import { AuthErrorCode, type Role, type UserType } from "@codeapt/shared";
import type { Request, RequestHandler } from "express";

import { AppError } from "../errors/app-error.js";
import { ACCESS_COOKIE } from "../lib/cookies.js";
import { TokenExpired, TokenInvalid, verifyAccessToken } from "../lib/jwt.js";
import { asyncHandler } from "../lib/async-handler.js";
import { UserModel } from "../models/user.model.js";

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[
    ACCESS_COOKIE
  ];
  return cookieToken ?? null;
}

export const requireAuth: RequestHandler = asyncHandler(
  async (req, _res, next) => {
    const token = extractToken(req);
    if (!token) {
      throw new AppError(
        "Authentication required",
        401,
        AuthErrorCode.UNAUTHENTICATED,
      );
    }

    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch (err) {
      if (err instanceof TokenExpired) {
        throw new AppError(
          "Access token expired",
          401,
          AuthErrorCode.TOKEN_EXPIRED,
        );
      }
      if (err instanceof TokenInvalid) {
        throw new AppError(
          "Invalid access token",
          401,
          AuthErrorCode.TOKEN_INVALID,
        );
      }
      throw err;
    }

    const user = await UserModel.findById(claims.sub).select(
      "role isActive forcePasswordChange tokenVersion userType college",
    );
    if (!user || !user.isActive) {
      throw new AppError(
        "Authentication required",
        401,
        AuthErrorCode.UNAUTHENTICATED,
      );
    }
    if (user.tokenVersion !== claims.tokenVersion) {
      throw new AppError("Session revoked", 401, AuthErrorCode.TOKEN_REVOKED);
    }

    req.auth = {
      userId: user._id.toString(),
      role: user.role as Role,
      forcePasswordChange: user.forcePasswordChange,
      userType: user.userType as UserType,
      college: user.college ? user.college.toString() : null,
    };
    next();
  },
);
