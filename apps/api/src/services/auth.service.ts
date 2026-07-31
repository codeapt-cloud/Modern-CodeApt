/**
 * Auth service — all session/token/password business logic. Controllers stay
 * thin and never touch models or tokens directly.
 *
 * Refresh strategy: rotation + reuse detection. Each login creates a
 * RefreshSession holding the current `jti`; every refresh rotates it. A replay
 * of a rotated token (jti mismatch) revokes the session. `tokenVersion` on the
 * User is the global kill-switch (bumped on change-password).
 */
import { randomUUID } from "node:crypto";

import {
  AuthErrorCode,
  Role,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
} from "@codeapt/shared";
import type { HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  isDjangoPasswordHash,
  verifyDjangoPassword,
} from "../lib/django-password.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  REFRESH_TTL_MS,
  TokenExpired,
  TokenInvalid,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/jwt.js";
import {
  ProfileModel,
  UserModel,
  type Profile,
  type User,
} from "../models/user.model.js";
import { RefreshSessionModel } from "../models/refresh-session.model.js";

export interface RequestContext {
  userAgent: string;
  ip: string;
}

type UserDoc = HydratedDocument<User>;
type ProfileDoc = HydratedDocument<Profile>;

export interface AuthResult {
  user: UserDoc;
  profile: ProfileDoc;
  accessToken: string;
  refreshToken: string;
}

// Precomputed lazily; used to equalize login timing when a user is not found
// (mitigates username/email enumeration via response-time analysis).
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("not-a-real-password");
  return dummyHashPromise;
}

function buildAvatarUrl(username: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    username,
  )}&background=random`;
}

/** Create a new session + issue an access/refresh pair for it. */
async function startSession(
  user: UserDoc,
  ctx: RequestContext,
): Promise<{ accessToken: string; refreshToken: string }> {
  const jti = randomUUID();
  const session = await RefreshSessionModel.create({
    user: user._id,
    jti,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: ctx.userAgent,
    ip: ctx.ip,
  });
  return issueTokens(user, session._id.toString(), jti);
}

function issueTokens(
  user: UserDoc,
  sid: string,
  jti: string,
): { accessToken: string; refreshToken: string } {
  const userId = user._id.toString();
  return {
    accessToken: signAccessToken({
      userId,
      role: user.role as Role,
      tokenVersion: user.tokenVersion,
    }),
    refreshToken: signRefreshToken({
      userId,
      sid,
      jti,
      tokenVersion: user.tokenVersion,
    }),
  };
}

async function getProfileOrThrow(userId: string): Promise<ProfileDoc> {
  const profile = await ProfileModel.findOne({ user: userId });
  if (!profile) {
    throw new AppError("Profile not found", 500, "PROFILE_MISSING");
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Register (students only; admins are seeded)
// ---------------------------------------------------------------------------

export async function registerStudent(
  input: RegisterInput,
): Promise<{ user: UserDoc; profile: ProfileDoc }> {
  const fields: Record<string, string> = {};
  if (await UserModel.exists({ email: input.email })) {
    fields.email = "Email is already registered";
  }
  if (await UserModel.exists({ username: input.username })) {
    fields.username = "Username is already taken";
  }
  if (await ProfileModel.exists({ rollNumber: input.rollNumber })) {
    fields.rollNumber = "Roll number is already registered";
  }
  if (Object.keys(fields).length > 0) {
    throw new AppError("Registration failed", 409, "CONFLICT", { fields });
  }

  const passwordHash = await hashPassword(input.password);
  const user = await UserModel.create({
    username: input.username,
    email: input.email,
    passwordHash,
    role: Role.STUDENT,
    forcePasswordChange: false,
  });

  try {
    const profile = await ProfileModel.create({
      user: user._id,
      fullName: input.fullName,
      collegeName: input.collegeName,
      rollNumber: input.rollNumber,
      phoneNumber: input.phoneNumber,
      state: input.state,
      avatarUrl: buildAvatarUrl(input.username),
    });
    return { user, profile };
  } catch (err) {
    // No multi-doc transactions on standalone Mongo — roll back the user so a
    // failed profile insert (e.g. a rollNumber race) leaves no orphan.
    await UserModel.deleteOne({ _id: user._id });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Verify a login password against the stored hash, transparently upgrading
 * inherited Django hashes to the native scheme on success.
 *
 * Routing at the single comparison point:
 *  - `pbkdf2_sha256$…` (migrated Django user) → verify with PBKDF2; on success
 *    re-hash with argon2id and persist (best-effort — a failed upgrade write
 *    must NOT block an otherwise-valid login).
 *  - anything else → the native argon2 verify (fails closed for bcrypt / other
 *    Django algos, which argon2.verify simply rejects).
 */
async function verifyLoginPassword(
  user: UserDoc,
  plain: string,
): Promise<boolean> {
  const stored = user.passwordHash;
  if (isDjangoPasswordHash(stored)) {
    const ok = verifyDjangoPassword(plain, stored);
    if (ok) {
      try {
        const upgraded = await hashPassword(plain);
        await UserModel.updateOne(
          { _id: user._id },
          { passwordHash: upgraded },
        );
        user.passwordHash = upgraded; // keep the in-memory doc consistent
      } catch {
        // Upgrade is opportunistic; the (correct) login proceeds regardless.
      }
    }
    return ok;
  }
  return verifyPassword(stored, plain);
}

export async function login(
  input: LoginInput,
  ctx: RequestContext,
): Promise<AuthResult> {
  const user = await UserModel.findOne({
    $or: [
      { email: input.identifier.toLowerCase() },
      { username: input.identifier },
    ],
  });

  const passwordOk = user
    ? await verifyLoginPassword(user, input.password)
    : await verifyPassword(await getDummyHash(), input.password);

  if (!user || !passwordOk) {
    // Generic — never reveal whether the account exists.
    throw new AppError(
      "Invalid username/email or password",
      401,
      AuthErrorCode.INVALID_CREDENTIALS,
    );
  }
  if (!user.isActive) {
    throw new AppError(
      "This account has been disabled",
      403,
      AuthErrorCode.ACCOUNT_DISABLED,
    );
  }

  const profile = await getProfileOrThrow(user._id.toString());
  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await startSession(user, ctx);
  return { user, profile, ...tokens };
}

// ---------------------------------------------------------------------------
// Refresh (rotation + reuse detection)
// ---------------------------------------------------------------------------

export async function refresh(token: string | undefined): Promise<AuthResult> {
  if (!token) {
    throw new AppError(
      "Refresh token required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }

  let claims;
  try {
    claims = verifyRefreshToken(token);
  } catch (err) {
    if (err instanceof TokenExpired) {
      throw new AppError(
        "Refresh token expired",
        401,
        AuthErrorCode.TOKEN_EXPIRED,
      );
    }
    if (err instanceof TokenInvalid) {
      throw new AppError(
        "Invalid refresh token",
        401,
        AuthErrorCode.TOKEN_INVALID,
      );
    }
    throw err;
  }

  const user = await UserModel.findById(claims.sub);
  if (!user || !user.isActive) {
    throw new AppError("Session invalid", 401, AuthErrorCode.UNAUTHENTICATED);
  }
  if (user.tokenVersion !== claims.tokenVersion) {
    throw new AppError("Session revoked", 401, AuthErrorCode.TOKEN_REVOKED);
  }

  const session = await RefreshSessionModel.findById(claims.sid);
  if (!session || session.revokedAt) {
    throw new AppError("Session revoked", 401, AuthErrorCode.SESSION_REVOKED);
  }
  if (session.jti !== claims.jti) {
    // A rotated/old token was replayed → treat as compromise, kill the session.
    session.revokedAt = new Date();
    await session.save();
    throw new AppError(
      "Refresh token reuse detected",
      401,
      AuthErrorCode.TOKEN_REUSE_DETECTED,
    );
  }

  // Rotate the jti in place; the session's absolute expiry is unchanged.
  const newJti = randomUUID();
  session.jti = newJti;
  await session.save();

  const profile = await getProfileOrThrow(user._id.toString());
  const tokens = issueTokens(user, session._id.toString(), newJti);
  return { user, profile, ...tokens };
}

// ---------------------------------------------------------------------------
// Logout (revoke the presented session)
// ---------------------------------------------------------------------------

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  try {
    const claims = verifyRefreshToken(token);
    await RefreshSessionModel.updateOne(
      { _id: claims.sid, user: claims.sub },
      { revokedAt: new Date() },
    );
  } catch {
    // Invalid/expired token — nothing to revoke; the controller still clears
    // cookies so the client ends up logged out either way.
  }
}

// ---------------------------------------------------------------------------
// Change password (authenticated)
// ---------------------------------------------------------------------------

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  ctx: RequestContext,
): Promise<AuthResult> {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }

  const currentOk = await verifyPassword(
    user.passwordHash,
    input.currentPassword,
  );
  if (!currentOk) {
    throw new AppError(
      "Current password is incorrect",
      400,
      AuthErrorCode.INVALID_CREDENTIALS,
    );
  }

  user.passwordHash = await hashPassword(input.newPassword);
  user.forcePasswordChange = false;
  user.tokenVersion += 1; // invalidates every existing access/refresh token
  await user.save();

  // Revoke all other sessions; the current device gets a fresh one below.
  await RefreshSessionModel.updateMany(
    { user: user._id, revokedAt: null },
    { revokedAt: new Date() },
  );

  const profile = await getProfileOrThrow(user._id.toString());
  const tokens = await startSession(user, ctx);
  return { user, profile, ...tokens };
}
