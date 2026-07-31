/**
 * JWT signing/verification for the access + refresh token pair.
 * Access and refresh are signed with SEPARATE secrets so leaking one never
 * lets an attacker mint the other. Expiry is derived from the env TTL strings.
 */
import type { Role } from "@codeapt/shared";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";

// `jsonwebtoken` is CommonJS; Node's ESM loader can't reliably resolve named
// VALUE exports from it, so we reach the error class via the default import.
const { TokenExpiredError } = jwt;

import { env } from "../config/env.js";
import { parseDurationToSeconds } from "./duration.js";

const ACCESS_TTL_SECONDS = parseDurationToSeconds(env.JWT_ACCESS_TTL);
const REFRESH_TTL_SECONDS = parseDurationToSeconds(env.JWT_REFRESH_TTL);

export const ACCESS_TTL_MS = ACCESS_TTL_SECONDS * 1000;
export const REFRESH_TTL_MS = REFRESH_TTL_SECONDS * 1000;

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  tokenVersion: number;
  type: "access";
}

export interface RefreshTokenClaims {
  sub: string;
  sid: string; // session id
  jti: string; // per-rotation identifier
  tokenVersion: number;
  type: "refresh";
}

export class TokenExpired extends Error {}
export class TokenInvalid extends Error {}

export function signAccessToken(params: {
  userId: string;
  role: Role;
  tokenVersion: number;
}): string {
  const payload = {
    role: params.role,
    tokenVersion: params.tokenVersion,
    type: "access" as const,
  };
  const options: SignOptions = {
    subject: params.userId,
    expiresIn: ACCESS_TTL_SECONDS,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(params: {
  userId: string;
  sid: string;
  jti: string;
  tokenVersion: number;
}): string {
  const payload = {
    sid: params.sid,
    jti: params.jti,
    tokenVersion: params.tokenVersion,
    type: "refresh" as const,
  };
  const options: SignOptions = {
    subject: params.userId,
    expiresIn: REFRESH_TTL_SECONDS,
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

function coerce<T>(payload: string | JwtPayload): T {
  if (typeof payload === "string") throw new TokenInvalid("Malformed token");
  return payload as T;
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    const claims = coerce<AccessTokenClaims>(decoded);
    if (claims.type !== "access") throw new TokenInvalid("Wrong token type");
    return claims;
  } catch (err) {
    if (err instanceof TokenExpiredError) throw new TokenExpired();
    if (err instanceof TokenInvalid) throw err;
    throw new TokenInvalid("Invalid access token");
  }
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
    const claims = coerce<RefreshTokenClaims>(decoded);
    if (claims.type !== "refresh") throw new TokenInvalid("Wrong token type");
    return claims;
  } catch (err) {
    if (err instanceof TokenExpiredError) throw new TokenExpired();
    if (err instanceof TokenInvalid) throw err;
    throw new TokenInvalid("Invalid refresh token");
  }
}
