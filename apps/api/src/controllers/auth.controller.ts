/**
 * Auth controllers — thin: validate with shared zod schemas, call the service,
 * set/clear cookies, shape the response. No business logic here.
 */
import {
  AuthErrorCode,
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  type AuthResponse,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from "../lib/cookies.js";
import { toPublicProfile, toPublicUser } from "../lib/serializers.js";
import {
  type AuthResult,
  type RequestContext,
  changePassword,
  login,
  logout,
  refresh,
  registerStudent,
} from "../services/auth.service.js";

function requestContext(req: Request): RequestContext {
  return {
    userAgent: req.headers["user-agent"] ?? "",
    ip: req.ip ?? "",
  };
}

function readRefreshToken(req: Request): string | undefined {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[
    REFRESH_COOKIE
  ];
  const bodyToken =
    typeof req.body?.refreshToken === "string"
      ? (req.body.refreshToken as string)
      : undefined;
  return cookieToken ?? bodyToken;
}

function buildAuthResponse(result: AuthResult): AuthResponse {
  return {
    user: toPublicUser(result.user),
    profile: toPublicProfile(result.profile),
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  };
}

export const registerController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = registerSchema.parse(req.body);
    const { user, profile } = await registerStudent(input);
    res.status(201).json({
      user: toPublicUser(user),
      profile: toPublicProfile(profile),
    });
  },
);

export const loginController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = loginSchema.parse(req.body);
    const result = await login(input, requestContext(req));
    setAuthCookies(res, result);
    res.status(200).json(buildAuthResponse(result));
  },
);

export const refreshController = asyncHandler(
  async (req: Request, res: Response) => {
    refreshSchema.parse(req.body ?? {});
    const result = await refresh(readRefreshToken(req));
    setAuthCookies(res, result);
    res.status(200).json(buildAuthResponse(result));
  },
);

export const logoutController = asyncHandler(
  async (req: Request, res: Response) => {
    await logout(readRefreshToken(req));
    clearAuthCookies(res);
    res.status(200).json({ success: true });
  },
);

export const changePasswordController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.auth) {
      throw new AppError(
        "Authentication required",
        401,
        AuthErrorCode.UNAUTHENTICATED,
      );
    }
    const input = changePasswordSchema.parse(req.body);
    const result = await changePassword(
      req.auth.userId,
      input,
      requestContext(req),
    );
    setAuthCookies(res, result);
    res.status(200).json(buildAuthResponse(result));
  },
);
