/**
 * The real Mongo-backed CodingRefreshStore + a deps builder that wires the real
 * adapters and clock. The pipeline (refresh.ts) stays store-injected so this DB
 * glue is thin and the decision logic is tested with fakes.
 */
import type {
  CodingHandleMap,
  CodingPlatform,
  StoredPlatformStat,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { env } from "../../config/env.js";
import { CodingProfileModel } from "../../models/coding-profile.model.js";
import { makeRealFetchAll, type CodingRefreshStore, type RefreshDeps } from "./refresh.js";

export const codingRefreshStore: CodingRefreshStore = {
  async loadProfile(collegeId, userId) {
    if (!Types.ObjectId.isValid(collegeId) || !Types.ObjectId.isValid(userId)) {
      return null;
    }
    const doc = await CodingProfileModel.findOne({
      college: new Types.ObjectId(collegeId),
      user: new Types.ObjectId(userId),
    }).lean();
    if (!doc) return null;

    const handles: CodingHandleMap = {
      codeforces: doc.handles?.codeforces ?? "",
      leetcode: doc.handles?.leetcode ?? "",
      codechef: doc.handles?.codechef ?? "",
    };
    const stats: StoredPlatformStat[] = (doc.stats ?? []).map((s) => ({
      platform: s.platform as CodingPlatform,
      handle: s.handle ?? "",
      rating: s.rating ?? null,
      maxRating: s.maxRating ?? null,
      problemsSolved: s.problemsSolved ?? null,
      rank: s.rank ?? null,
      status: s.status,
      verified: s.verified ?? false,
      raw: s.raw ?? null,
      lastFetchedAt: s.lastFetchedAt ?? null,
    }));
    return { handles, stats };
  },

  async saveStats(collegeId, userId, stats) {
    await CodingProfileModel.updateOne(
      {
        college: new Types.ObjectId(collegeId),
        user: new Types.ObjectId(userId),
      },
      {
        $set: {
          stats: stats.map((s) => ({
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
          })),
        },
      },
    );
  },
};

export function buildRefreshDeps(): RefreshDeps {
  return {
    store: codingRefreshStore,
    fetchAll: makeRealFetchAll(env.CODING_REFRESH_TIMEOUT_MS),
    now: () => new Date(),
  };
}
