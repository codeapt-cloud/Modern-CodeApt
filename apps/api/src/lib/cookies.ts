/**
 * httpOnly auth cookies. The refresh cookie is scoped to `/api/auth` so it is
 * only ever sent to the endpoints that need it (refresh, logout).
 */
import type { CookieOptions, Response } from "express";

import { env, isProduction } from "../config/env.js";
import { ACCESS_TTL_MS, REFRESH_TTL_MS } from "./jwt.js";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

/** Path the refresh cookie is limited to. */
const REFRESH_COOKIE_PATH = "/api/auth";

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction, // relaxed in dev (http://localhost)
    sameSite: env.COOKIE_SAMESITE,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOptions(),
    path: "/",
    maxAge: ACCESS_TTL_MS,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions(),
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearAuthCookies(res: Response): void {
  const opts = baseOptions();
  res.clearCookie(ACCESS_COOKIE, { ...opts, path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...opts, path: REFRESH_COOKIE_PATH });
}
