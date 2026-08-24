/**
 * CodingProfile (Prompt 1) — a college student's competitive-coding handles +
 * the STORED, normalized stats fetched per platform. One doc per (college, user)
 * with an embedded per-platform stats array. Kept as a sibling collection (not
 * embedded on User/Profile) because it is a periodically-refreshed blob off the
 * auth hot path — mirroring the AttendanceRecord sibling-doc pattern.
 *
 * Tenancy: carries `college` and is ALWAYS queried through the tenant scope.
 * Resilience: only a successful fetch overwrites the numbers; a not_found/error
 * keeps the last-known values and just flags `status` (see shared mergePlatformStat).
 */
import {
  CODING_FETCH_STATUS_VALUES,
  CODING_PLATFORM_VALUES,
  CodingFetchStatus,
} from "@codeapt/shared";
import { Schema, model, type InferSchemaType } from "mongoose";

const platformStatSchema = new Schema(
  {
    platform: { type: String, enum: CODING_PLATFORM_VALUES, required: true },
    /** The handle these numbers belong to (a handle change resets the entry). */
    handle: { type: String, default: "", trim: true },
    rating: { type: Number, default: null },
    maxRating: { type: Number, default: null },
    problemsSolved: { type: Number, default: null },
    rank: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: CODING_FETCH_STATUS_VALUES,
      default: CodingFetchStatus.NEVER,
    },
    /**
     * Whether the student proved ownership of this handle (a verification
     * challenge). Default false: every handle is self-reported until proven, and
     * a successful fetch proves the handle exists, not that the caller owns it.
     * The leaderboard ranks only verified handles.
     */
    verified: { type: Boolean, default: false },
    /** The (trimmed) source payload for auditing/future fields. Server-only. */
    raw: { type: Schema.Types.Mixed, default: null },
    lastFetchedAt: { type: Date, default: null },
  },
  { _id: false },
);

const codingProfileSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: "College", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** Handles the student entered (blank = not linked). Trusted, unverified. */
    handles: {
      codeforces: { type: String, default: "", trim: true },
      leetcode: { type: String, default: "", trim: true },
      codechef: { type: String, default: "", trim: true },
    },
    stats: { type: [platformStatSchema], default: [] },
  },
  { timestamps: true },
);
// One profile per student per college (the self upsert key).
codingProfileSchema.index({ college: 1, user: 1 }, { unique: true });
// Prompt-2 leaderboard: fast reads by college + platform + rating.
codingProfileSchema.index({ college: 1, "stats.platform": 1, "stats.rating": -1 });

export type CodingProfileDoc = InferSchemaType<typeof codingProfileSchema>;

export const CodingProfileModel = model("CodingProfile", codingProfileSchema);
