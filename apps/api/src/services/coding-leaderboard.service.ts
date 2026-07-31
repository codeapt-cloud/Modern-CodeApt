/**
 * Coding leaderboard service (Prompt 2) — tenant + faculty-scoped READ-ONLY
 * ranking over the Prompt-1 stored CodingProfiles. It fetches NOTHING live (the
 * worker owns platform fetching); it only reads our own stored stats, so it is
 * always fast and resilient.
 *
 * Structurally mirrors college-analytics `analyticsByOrgUnit`: resolve the
 * actor's scoped student population (reusing listCollegeStudents +
 * resolveActorScope so the faculty-scope rule is computed one way), optionally
 * narrow by an org-unit subtree (collectDescendantUnitIds) and/or an attendance
 * GROUP's members (reusing getManageableGroup's authority), read the population's
 * CodingProfiles, then rank via the pure shared helper.
 *
 * Honesty: only real `ok` stats are ranked (rankByMetric); linked-but-na/stale
 * students are returned unranked (rank null) — never a fabricated rank.
 */
import {
  collectDescendantUnitIds,
  rankByMetric,
  CodingFetchStatus,
  StudentErrorCode,
  type CodingLeaderboardQuery,
  type CodingLeaderboardResponse,
  type CodingLeaderboardRow,
  type CodingPlatform,
  type CodingPlatformStat,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope } from "../lib/tenant-scope.js";
import { CodingProfileModel } from "../models/coding-profile.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { getManageableGroup, type AttendanceActor } from "./attendance.service.js";
import {
  inScope,
  listCollegeStudents,
  resolveActorScope,
  type StudentActor,
} from "./student.service.js";

export type LeaderboardActor = StudentActor;

interface StatSubdoc {
  platform: string;
  handle?: string | null;
  rating?: number | null;
  maxRating?: number | null;
  problemsSolved?: number | null;
  rank?: string | null;
  status: string;
  lastFetchedAt?: Date | null;
}

/** Map a stored stat subdoc → the client DTO (never exposes `raw`). */
function toStatDTO(s: StatSubdoc): CodingPlatformStat {
  const rank = (s.rank ?? "").trim();
  return {
    platform: s.platform as CodingPlatform,
    handle: (s.handle ?? "").trim(),
    rating: s.rating ?? null,
    maxRating: s.maxRating ?? null,
    problemsSolved: s.problemsSolved ?? null,
    rank: rank === "" ? null : rank,
    status: s.status as CodingFetchStatus,
    lastFetchedAt: s.lastFetchedAt ? new Date(s.lastFetchedAt).toISOString() : null,
  };
}

/** A linked student's assembled row (pre-rank). */
interface LinkedRow {
  studentId: string;
  fullName: string;
  rollNumber: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  stats: CodingPlatformStat[];
}

export async function getCodingLeaderboard(
  collegeId: string,
  actor: LeaderboardActor,
  query: CodingLeaderboardQuery,
): Promise<CodingLeaderboardResponse> {
  const scope = createTenantScope(collegeId);
  const { platform, metric } = query;

  const [actorScope, { items: students }, unitDocs] = await Promise.all([
    resolveActorScope(scope, actor),
    listCollegeStudents(collegeId, actor, {}),
    OrgUnitModel.find(scope.filter()).select("_id name parent"),
  ]);

  const unitName = new Map(unitDocs.map((u) => [u._id.toString(), u.name]));

  // Population = the actor's scoped students, optionally narrowed by filters.
  let population = students;

  // Org-unit subtree filter (descendant math), scope-checked.
  if (query.unitId) {
    if (!Types.ObjectId.isValid(query.unitId) || !inScope(actorScope, query.unitId)) {
      throw new AppError(
        "That org-unit is outside your assigned scope",
        403,
        StudentErrorCode.ORG_UNIT_OUT_OF_SCOPE,
      );
    }
    const refs = unitDocs.map((u) => ({
      id: u._id.toString(),
      parentId: u.parent ? u.parent.toString() : null,
    }));
    const subtree = new Set(collectDescendantUnitIds(refs, [query.unitId]));
    population = population.filter(
      (s) => s.orgUnitId !== null && subtree.has(s.orgUnitId),
    );
  }

  // Attendance-group filter — reuse the group's own authority (admin=any,
  // faculty=created/owned, else 404). Intersect its members with the population.
  if (query.groupId) {
    const group = await getManageableGroup(
      scope,
      actor as AttendanceActor,
      query.groupId,
    );
    const memberIds = new Set(group.members.map((m) => m.student.toString()));
    population = population.filter((s) => memberIds.has(s.id));
  }

  const totalStudents = population.length;

  // Read the population's stored coding profiles (tenant-scoped; raw omitted).
  const profiles =
    population.length === 0
      ? []
      : await CodingProfileModel.find(
          scope.filter({ user: { $in: population.map((s) => new Types.ObjectId(s.id)) } }),
        )
          .select("-stats.raw")
          .lean();
  const profileByUser = new Map(profiles.map((p) => [p.user.toString(), p]));

  // A row per LINKED student (≥1 non-empty handle) — students who opted in.
  const linked: LinkedRow[] = [];
  for (const s of population) {
    const profile = profileByUser.get(s.id);
    if (!profile) continue;
    const handles = (profile.handles ?? {}) as {
      codeforces?: string | null;
      leetcode?: string | null;
      codechef?: string | null;
    };
    const anyHandle =
      (handles.codeforces ?? "").trim() !== "" ||
      (handles.leetcode ?? "").trim() !== "" ||
      (handles.codechef ?? "").trim() !== "";
    if (!anyHandle) continue;
    linked.push({
      studentId: s.id,
      fullName: s.fullName,
      rollNumber: s.rollNumber,
      orgUnitId: s.orgUnitId,
      orgUnitName: s.orgUnitId ? (unitName.get(s.orgUnitId) ?? null) : null,
      stats: (profile.stats ?? []).map(toStatDTO),
    });
  }

  // Pure ranking over real `ok` stats; na/stale → unranked.
  const { ranked, unranked } = rankByMetric(linked, platform, metric);

  const rowFor = (row: LinkedRow, rank: number | null): CodingLeaderboardRow => {
    const chosen = row.stats.find((st) => st.platform === platform) ?? null;
    return {
      rank,
      studentId: row.studentId,
      fullName: row.fullName,
      rollNumber: row.rollNumber,
      orgUnitId: row.orgUnitId,
      orgUnitName: row.orgUnitName,
      metricValue:
        rank === null
          ? null
          : metric === "rating"
            ? (chosen?.rating ?? null)
            : (chosen?.problemsSolved ?? null),
      rankedStatus: chosen ? chosen.status : CodingFetchStatus.NEVER,
      rankedLastFetchedAt: chosen ? chosen.lastFetchedAt : null,
      stats: row.stats,
    };
  };

  const rows: CodingLeaderboardRow[] = [
    ...ranked.map((e) => rowFor(e.row, e.rank)),
    ...unranked.map((row) => rowFor(row, null)),
  ];

  // Freshness range over the ranked (ok) chosen-platform stats.
  let from: string | null = null;
  let to: string | null = null;
  for (const e of ranked) {
    const ts = e.row.stats.find((st) => st.platform === platform)?.lastFetchedAt ?? null;
    if (!ts) continue;
    if (from === null || ts < from) from = ts;
    if (to === null || ts > to) to = ts;
  }

  return {
    overview: {
      platform,
      metric,
      totalStudents,
      linked: linked.length,
      ranked: ranked.length,
      unranked: linked.length - ranked.length,
      lastRefreshedFrom: from,
      lastRefreshedTo: to,
    },
    rows,
  };
}
