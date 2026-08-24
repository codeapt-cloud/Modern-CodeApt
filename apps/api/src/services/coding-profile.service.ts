/**
 * Coding-profile service (Prompt 1) — a college student's OWN handles + stored
 * per-platform stats, plus the manual "refresh now" trigger. All reads/writes go
 * through the tenant scope (never cross-tenant). Students edit only their OWN
 * handles (the id is always the caller). Fetching itself happens in the WORKER
 * (egress + pacing live there); these endpoints only store handles + enqueue a
 * refresh, so the API never makes an outbound coding-platform call.
 */
import {
  CODING_PLATFORM_VALUES,
  CodingProfileErrorCode,
  initialStat,
  isCollegeStudent,
  type CodingFetchStatus,
  type CodingHandles,
  type CodingPlatform,
  type CodingPlatformStat,
  type CodingProfileResponse,
  type Role as RoleT,
  type SetCodingHandlesInput,
  type StoredPlatformStat,
  type UserType as UserTypeT,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope } from "../lib/tenant-scope.js";
import { enqueueCodingRefreshJob } from "../lib/execution-queue.js";
import { CodingProfileModel } from "../models/coding-profile.model.js";
import { UserModel } from "../models/user.model.js";

interface Actor {
  role: RoleT;
  userType: UserTypeT;
}

/** Guard: only college students keep coding profiles. */
function assertStudent(actor: Actor): void {
  if (!isCollegeStudent(actor.role, actor.userType)) {
    throw new AppError(
      "Only college students have coding profiles",
      403,
      CodingProfileErrorCode.NOT_A_STUDENT,
    );
  }
}

/** Empty (never-linked) profile for a student who hasn't added handles yet. */
function emptyProfile(): CodingProfileResponse {
  return {
    handles: { codeforces: null, leetcode: null, codechef: null },
    stats: [],
    refreshQueued: false,
    updatedAt: null,
  };
}

function blankToNull(v: string | undefined | null): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/** Map a stored stat subdoc to the client-facing DTO (never exposes `raw`). */
function statToDTO(s: {
  platform: string;
  handle?: string | null;
  rating?: number | null;
  maxRating?: number | null;
  problemsSolved?: number | null;
  rank?: string | null;
  status: string;
  verified?: boolean | null;
  lastFetchedAt?: Date | null;
}): CodingPlatformStat {
  return {
    platform: s.platform as CodingPlatform,
    handle: (s.handle ?? "").trim(),
    rating: s.rating ?? null,
    maxRating: s.maxRating ?? null,
    problemsSolved: s.problemsSolved ?? null,
    rank: blankToNull(s.rank),
    status: s.status as CodingFetchStatus,
    verified: s.verified ?? false,
    lastFetchedAt: s.lastFetchedAt ? new Date(s.lastFetchedAt).toISOString() : null,
  };
}

/** Convert a shared StoredPlatformStat to a Mongo-friendly subdoc. */
function statToSubdoc(s: StoredPlatformStat) {
  return {
    platform: s.platform,
    handle: s.handle,
    rating: s.rating,
    maxRating: s.maxRating,
    problemsSolved: s.problemsSolved,
    rank: s.rank ?? "",
    status: s.status,
    verified: s.verified,
    raw: s.raw ?? null,
    lastFetchedAt: s.lastFetchedAt,
  };
}

interface ProfileDocLike {
  handles?: {
    codeforces?: string | null;
    leetcode?: string | null;
    codechef?: string | null;
  } | null;
  stats?: Parameters<typeof statToDTO>[0][];
  updatedAt?: Date;
}

function docToResponse(
  doc: ProfileDocLike,
  refreshQueued: boolean,
): CodingProfileResponse {
  const handles: CodingHandles = {
    codeforces: blankToNull(doc.handles?.codeforces),
    leetcode: blankToNull(doc.handles?.leetcode),
    codechef: blankToNull(doc.handles?.codechef),
  };
  // Stable, platform-ordered output.
  const byPlatform = new Map((doc.stats ?? []).map((s) => [s.platform, s]));
  const stats = CODING_PLATFORM_VALUES.filter((p) => byPlatform.has(p)).map((p) =>
    statToDTO(byPlatform.get(p)!),
  );
  return {
    handles,
    stats,
    refreshQueued,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

/** The calling student's OWN coding profile (own-data-only). */
export async function getMyCodingProfile(
  collegeId: string,
  userId: string,
  actor: Actor,
): Promise<CodingProfileResponse> {
  assertStudent(actor);
  const scope = createTenantScope(collegeId);
  const doc = await CodingProfileModel.findOne(
    scope.filter({ user: new Types.ObjectId(userId) }),
  ).lean();
  if (!doc) return emptyProfile();
  return docToResponse(doc, false);
}

/**
 * Set/update the calling student's handles. Omitted fields are left unchanged;
 * an empty string clears that platform (and drops its stats). A new/changed
 * handle resets that platform's stats to `never` (the old numbers belonged to a
 * different handle). Enqueues a refresh so fresh stats arrive without waiting
 * for the daily sweep.
 */
export async function setMyCodingHandles(
  collegeId: string,
  userId: string,
  input: SetCodingHandlesInput,
  actor: Actor,
): Promise<CodingProfileResponse> {
  assertStudent(actor);
  const scope = createTenantScope(collegeId);
  const uid = new Types.ObjectId(userId);
  const existing = await CodingProfileModel.findOne(scope.filter({ user: uid }));

  const priorHandles = {
    codeforces: (existing?.handles?.codeforces ?? "").trim(),
    leetcode: (existing?.handles?.leetcode ?? "").trim(),
    codechef: (existing?.handles?.codechef ?? "").trim(),
  };
  // Merge: a key present in the input overrides; absent keeps the prior handle.
  const nextHandles: Record<CodingPlatform, string> = {
    codeforces:
      input.codeforces !== undefined ? input.codeforces.trim() : priorHandles.codeforces,
    leetcode:
      input.leetcode !== undefined ? input.leetcode.trim() : priorHandles.leetcode,
    codechef:
      input.codechef !== undefined ? input.codechef.trim() : priorHandles.codechef,
  };

  const priorStats = new Map<CodingPlatform, StoredPlatformStat>(
    (existing?.stats ?? []).map((s) => [
      s.platform as CodingPlatform,
      {
        platform: s.platform as CodingPlatform,
        handle: (s.handle ?? "").trim(),
        rating: s.rating ?? null,
        maxRating: s.maxRating ?? null,
        problemsSolved: s.problemsSolved ?? null,
        rank: blankToNull(s.rank),
        status: s.status as CodingFetchStatus,
        verified: s.verified ?? false,
        raw: null,
        lastFetchedAt: s.lastFetchedAt ?? null,
      },
    ]),
  );

  // Rebuild stats: one entry per LINKED platform; unchanged handles keep their
  // numbers, new/changed handles reset to a never-fetched entry.
  const nextStats: StoredPlatformStat[] = [];
  for (const platform of CODING_PLATFORM_VALUES) {
    const handle = nextHandles[platform];
    if (!handle) continue; // cleared / never linked → no stat entry
    const prev = priorStats.get(platform);
    nextStats.push(
      prev && prev.handle === handle ? prev : initialStat(platform, handle),
    );
  }

  const anyLinked = CODING_PLATFORM_VALUES.some((p) => nextHandles[p] !== "");

  const doc =
    existing ??
    new CodingProfileModel(scope.attach({ user: uid }));
  doc.set("handles", {
    codeforces: nextHandles.codeforces,
    leetcode: nextHandles.leetcode,
    codechef: nextHandles.codechef,
  });
  doc.set("stats", nextStats.map(statToSubdoc));
  await doc.save();

  // Populate fresh stats soon (rate-limited on the worker; a no-op if no handles).
  if (anyLinked) {
    await enqueueCodingRefreshJob({ collegeId, userId });
  }

  return docToResponse(doc.toObject() as ProfileDocLike, anyLinked);
}

/** Manual "refresh now" for the calling student's own profile. */
export async function refreshMyCodingProfile(
  collegeId: string,
  userId: string,
  actor: Actor,
): Promise<{ queued: boolean }> {
  assertStudent(actor);
  const scope = createTenantScope(collegeId);
  const doc = await CodingProfileModel.findOne(
    scope.filter({ user: new Types.ObjectId(userId) }),
  ).lean();
  const anyLinked =
    !!doc &&
    CODING_PLATFORM_VALUES.some((p) => ((doc.handles?.[p] ?? "") as string).trim() !== "");
  if (!anyLinked) return { queued: false };
  await enqueueCodingRefreshJob({ collegeId, userId });
  return { queued: true };
}

/**
 * Admin "refresh now" for a specific student's profile. Verifies the target is a
 * college student of THIS college (tenant-isolated), then enqueues.
 */
export async function refreshStudentCodingProfile(
  collegeId: string,
  studentUserId: string,
): Promise<{ queued: boolean }> {
  if (!Types.ObjectId.isValid(studentUserId)) {
    throw new AppError("Student not found", 404, CodingProfileErrorCode.STUDENT_NOT_FOUND);
  }
  const student = await UserModel.findOne({
    _id: new Types.ObjectId(studentUserId),
    college: new Types.ObjectId(collegeId),
  })
    .select("role userType")
    .lean();
  if (!student || !isCollegeStudent(student.role as RoleT, student.userType as UserTypeT)) {
    throw new AppError("Student not found", 404, CodingProfileErrorCode.STUDENT_NOT_FOUND);
  }
  await enqueueCodingRefreshJob({ collegeId, userId: studentUserId });
  return { queued: true };
}
