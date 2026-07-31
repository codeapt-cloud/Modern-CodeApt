/**
 * College challenge service (Phase 4d) — a tenant-scoped LEADERBOARD over the
 * EXISTING daily-challenge engine. Nothing here forks the engine: the daily
 * challenge stays ONE global problem per day with a global leaderboard + per-user
 * streaks, solved by every student in the shared learner experience (unchanged).
 *
 * The only college-specific artifact is a read: how THIS college's students rank
 * on the daily challenge. It reuses the shared `UserStreak` (the same doc the
 * global leaderboard sorts) but scopes it to the college's members — there is no
 * `college` field on UserStreak (streaks are per-user + global), so the tenant
 * boundary is applied via the User set (createTenantScope over UserModel, which
 * DOES carry `college`). Individual/global challenge flows are entirely untouched
 * (no model/engine change), which is why the existing challenge suite stays green.
 *
 * Gated by the `challenges` feature; an operator (college_admin/faculty) view.
 * Rich per-department/section analytics is the Phase 5 seam.
 */
import type {
  CollegeChallengeLeaderboardResponse,
  CollegeChallengeRow,
  LeaderboardQuery,
} from "@codeapt/shared";
import type { Types } from "mongoose";

import { createTenantScope } from "../lib/tenant-scope.js";
import { UserStreakModel } from "../models/challenge.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";

interface StreakLean {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  totalScore: number;
  currentStreak: number;
  maxStreak: number;
}

export async function collegeChallengeLeaderboard(
  collegeId: string,
  query: LeaderboardQuery,
): Promise<CollegeChallengeLeaderboardResponse> {
  const { page, pageSize } = query;
  const scope = createTenantScope(collegeId);

  // Tenant boundary: the users that belong to THIS college (UserModel carries
  // `college`; UserStreak does not). Everything downstream is filtered to this set.
  const members = await UserModel.find(scope.filter()).select("_id");
  const memberIds = members.map((u) => u._id);
  if (memberIds.length === 0) {
    return { rows: [], page, pageSize, total: 0 };
  }

  const baseFilter = { user: { $in: memberIds }, totalScore: { $gt: 0 } };
  const total = await UserStreakModel.countDocuments(baseFilter);

  const skip = (page - 1) * pageSize;
  const docs = await UserStreakModel.find(baseFilter)
    .sort({ totalScore: -1, currentStreak: -1, _id: 1 })
    .skip(skip)
    .limit(pageSize)
    .lean<StreakLean[]>();

  const rows = await hydrateRows(docs, skip);
  return { rows, page, pageSize, total };
}

async function hydrateRows(
  docs: StreakLean[],
  skip: number,
): Promise<CollegeChallengeRow[]> {
  if (docs.length === 0) return [];
  const userIds = docs.map((d) => d.user);
  // Name from the Profile; the per-college roll lives on User.rollNumber (the
  // Profile roll is a placeholder for college students) — mirrors exam/essay results.
  const [profiles, users] = await Promise.all([
    ProfileModel.find({ user: { $in: userIds } }).select("user fullName").lean<
      { user: Types.ObjectId; fullName: string }[]
    >(),
    UserModel.find({ _id: { $in: userIds } }).select("rollNumber").lean<
      { _id: Types.ObjectId; rollNumber?: string }[]
    >(),
  ]);
  const nameByUser = new Map(profiles.map((p) => [p.user.toString(), p.fullName]));
  const rollByUser = new Map(
    users.map((u) => [u._id.toString(), u.rollNumber ?? ""]),
  );

  return docs.map((d, i) => {
    const uid = d.user.toString();
    return {
      rank: skip + i + 1,
      userId: uid,
      name: nameByUser.get(uid) ?? "Student",
      rollNumber: rollByUser.get(uid) ?? "",
      totalScore: d.totalScore,
      currentStreak: d.currentStreak,
      maxStreak: d.maxStreak,
    };
  });
}
