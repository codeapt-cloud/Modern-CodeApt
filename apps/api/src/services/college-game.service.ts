/**
 * College GameSet authoring — tenant-scoped over the same GameSet model, mirror
 * of college-exam.service. Isolation is enforced by routing every query through
 * createTenantScope (a set not tagged with this tenant simply isn't found → 404);
 * org-unit targeting is validated in-tenant and within a faculty's scope. Detail
 * serialization is shared with the platform-admin surface (game-set-admin).
 */
import {
  GameErrorCode,
  GameSelectionMode,
  GameSetAttemptStatus,
  Role,
  UserType,
  collectDescendantUnitIds,
  type CloneGameSetRequest,
  type GameAttemptAdminList,
  type GameCohortCell,
  type GameCohortReport,
  type GameCohortRow,
  type GameKey,
  type GamePlayListItem,
  type GamePlayListResponse,
  type GameSetDetail,
  type GameSetListResponse,
  type GameSetUpdate,
  type GameSetUpsert,
  type GameSpecInput,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import {
  GameAttemptModel,
  GameSetAttemptModel,
  GameSetModel,
  type GameSet,
  type GameSetAttempt,
} from "../models/game.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import { countUsedAttempts } from "./game.service.js";
import {
  assertDeletable,
  assertPublishable,
  buildGames,
  toGamePlayListItem,
  toGameSetDetail,
  toGameSetListItem,
} from "./game-set-admin.service.js";
import {
  resolveActorScope,
  type ActorScope,
  type StudentActor,
} from "./student.service.js";

type GameSetDoc = HydratedDocument<GameSet>;
export type GameActor = StudentActor;

const NOT_FOUND = (): AppError =>
  new AppError("Game set not found", 404, GameErrorCode.GAME_SET_NOT_FOUND);
const OUT_OF_SCOPE = (msg: string): AppError =>
  new AppError(msg, 403, GameErrorCode.ORG_UNIT_OUT_OF_SCOPE);

/** Validate target org-units: each must exist in-tenant and (for faculty) be in
 * the actor's scope; faculty must target at least one unit. */
async function validateTargetUnits(
  scope: TenantScope,
  actorScope: ActorScope,
  orgUnitIds: string[],
): Promise<Types.ObjectId[]> {
  const unique = [...new Set(orgUnitIds)];
  for (const id of unique) {
    if (!Types.ObjectId.isValid(id)) {
      throw OUT_OF_SCOPE("One or more target org-units are invalid");
    }
  }
  if (unique.length === 0) {
    if (!actorScope.unrestricted) {
      throw OUT_OF_SCOPE(
        "Faculty must target one or more org-units within their scope",
      );
    }
    return [];
  }
  const found = await OrgUnitModel.find(
    scope.filter({ _id: { $in: unique } }),
  ).select("_id");
  if (found.length !== unique.length) {
    throw OUT_OF_SCOPE("One or more target org-units are not in this college");
  }
  if (!actorScope.unrestricted) {
    for (const id of unique) {
      if (!actorScope.unitIds.has(id)) {
        throw OUT_OF_SCOPE("One or more target org-units are outside your scope");
      }
    }
  }
  return unique.map((id) => new Types.ObjectId(id));
}

function assertManageable(gs: GameSetDoc, actorScope: ActorScope): void {
  if (actorScope.unrestricted) return;
  const units = (gs.orgUnits ?? []).map((u) => u.toString());
  if (units.length === 0 || !units.every((u) => actorScope.unitIds.has(u))) {
    throw OUT_OF_SCOPE("This game set is outside your scope");
  }
}

async function requireTenantGameSet(
  scope: TenantScope,
  id: string,
): Promise<GameSetDoc> {
  if (!Types.ObjectId.isValid(id)) throw NOT_FOUND();
  const gs = await GameSetModel.findOne(scope.filter({ _id: id }));
  if (!gs) throw NOT_FOUND();
  return gs;
}

function resolvePickCount(
  mode: GameSetUpsert["selectionMode"],
  pickCount: number | undefined,
): number | null {
  return mode === GameSelectionMode.RANDOM_N_OF_POOL ? (pickCount ?? null) : null;
}

export async function createCollegeGameSet(
  collegeId: string,
  actor: GameActor,
  input: GameSetUpsert,
): Promise<GameSetDetail> {
  // A tenant set can never carry a curriculum topic — that would be the invalid
  // (college != null && topic != null) shape. Reject it here (the schema allows
  // topicId only so the platform authoring surface can use it).
  if (input.topicId) {
    throw new AppError(
      "A college game set cannot attach to a curriculum topic",
      400,
      GameErrorCode.INVALID_GAME_SET_SHAPE,
    );
  }
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const orgUnits = await validateTargetUnits(scope, actorScope, input.orgUnitIds);
  const gs = await GameSetModel.create(
    scope.attach({
      title: input.title,
      description: input.description,
      games: buildGames(input.games),
      selectionMode: input.selectionMode,
      pickCount: resolvePickCount(input.selectionMode, input.pickCount),
      orgUnits,
      perQuestionTimerSeconds: input.perQuestionTimerSeconds,
      instantFeedback: input.instantFeedback,
      maxAttempts: input.maxAttempts,
      source: input.source, // audit trail — "ai_drafted" when from an AI draft
      isPublished: false,
    }),
  );
  return toGameSetDetail(gs);
}

export async function listCollegeGameSets(
  collegeId: string,
  actor: GameActor,
): Promise<GameSetListResponse> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const sets = await GameSetModel.find(scope.filter()).sort({
    createdAt: -1,
    _id: -1,
  });
  const manageable = actorScope.unrestricted
    ? sets
    : sets.filter((s) => {
        const units = (s.orgUnits ?? []).map((u) => u.toString());
        return units.length > 0 && units.every((u) => actorScope.unitIds.has(u));
      });
  return { items: manageable.map(toGameSetListItem) };
}

export async function getCollegeGameSet(
  collegeId: string,
  actor: GameActor,
  id: string,
): Promise<GameSetDetail> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const gs = await requireTenantGameSet(scope, id);
  assertManageable(gs, actorScope);
  return toGameSetDetail(gs);
}

export async function updateCollegeGameSet(
  collegeId: string,
  actor: GameActor,
  id: string,
  input: GameSetUpdate,
): Promise<GameSetDetail> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const gs = await requireTenantGameSet(scope, id);
  assertManageable(gs, actorScope);

  if (input.title !== undefined) gs.title = input.title;
  if (input.description !== undefined) gs.description = input.description;
  if (input.games !== undefined) gs.games = buildGames(input.games);
  if (input.selectionMode !== undefined) gs.selectionMode = input.selectionMode;
  if (input.selectionMode !== undefined || input.pickCount !== undefined) {
    gs.pickCount = resolvePickCount(
      input.selectionMode ?? (gs.selectionMode as GameSetUpsert["selectionMode"]),
      input.pickCount ?? gs.pickCount ?? undefined,
    );
  }
  if (input.perQuestionTimerSeconds !== undefined)
    gs.perQuestionTimerSeconds = input.perQuestionTimerSeconds;
  if (input.instantFeedback !== undefined)
    gs.instantFeedback = input.instantFeedback;
  if (input.maxAttempts !== undefined) gs.maxAttempts = input.maxAttempts;
  if (input.orgUnitIds !== undefined) {
    gs.orgUnits = await validateTargetUnits(scope, actorScope, input.orgUnitIds);
  }
  await gs.save();
  return toGameSetDetail(gs);
}

export async function setCollegeGameSetPublished(
  collegeId: string,
  actor: GameActor,
  id: string,
  isPublished: boolean,
): Promise<GameSetDetail> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const gs = await requireTenantGameSet(scope, id);
  assertManageable(gs, actorScope);
  if (isPublished) assertPublishable(gs); // games>0 AND pickCount<=pool (shared)
  gs.isPublished = isPublished;
  await gs.save();
  return toGameSetDetail(gs);
}

export async function deleteCollegeGameSet(
  collegeId: string,
  actor: GameActor,
  id: string,
): Promise<void> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const gs = await requireTenantGameSet(scope, id);
  assertManageable(gs, actorScope);
  await assertDeletable(gs); // draft only, no attempts (shared)
  await GameSetModel.deleteOne(scope.filter({ _id: gs._id }));
}

/**
 * Clone a PLATFORM game set into this college as an INDEPENDENT, tenant-owned,
 * UNPUBLISHED copy (college = X, topic = null, no org-unit targeting). Mirrors
 * duplicateCollegeExam: it copies the games array + settings and does NOT link
 * back to the source. The source must be a platform set (college:null) — so a
 * college can neither clone another college's private set (not found) nor, since
 * the destination is always the resolved tenant, clone into a different college.
 * This is AUTHORING → gated by CollegeFeature.GAMING at the route.
 */
export async function cloneGameSetIntoCollege(
  collegeId: string,
  actor: GameActor,
  sourceId: string,
  input: CloneGameSetRequest,
): Promise<GameSetDetail> {
  const scope = createTenantScope(collegeId);
  await resolveActorScope(scope, actor); // ensure the actor is a valid operator
  if (!Types.ObjectId.isValid(sourceId)) throw NOT_FOUND();
  const source = await GameSetModel.findOne({ _id: sourceId, college: null });
  if (!source) throw NOT_FOUND();

  const gs = await GameSetModel.create(
    scope.attach({
      topic: null, // an independent tenant copy — never course-linked
      title: input.title,
      description: source.description,
      games: buildGames(
        source.games.map((g) => ({
          gameKey: g.gameKey as GameSpecInput["gameKey"],
          durationSeconds: g.durationSeconds,
          allowSkip: g.allowSkip,
          startingDifficulty:
            g.startingDifficulty as GameSpecInput["startingDifficulty"],
          maxQuestions: g.maxQuestions,
          onWallHit: (g.onWallHit ?? "block") as GameSpecInput["onWallHit"],
        })),
      ),
      selectionMode: source.selectionMode,
      pickCount: source.pickCount ?? null,
      orgUnits: [], // no targeting until the college sets it
      perQuestionTimerSeconds: source.perQuestionTimerSeconds,
      instantFeedback: source.instantFeedback,
      maxAttempts: source.maxAttempts,
      isPublished: false,
    }),
  );
  return toGameSetDetail(gs);
}

/**
 * The published, in-target tenant sets a STUDENT of this college can play.
 * Org-unit targeting is resolved against the student's own unit (descendant
 * math), mirroring assertCanPlayGameSet's tenant branch. Projection is
 * operator-safe (toGamePlayListItem) — no seeds, no internals.
 */
export async function listPlayableCollegeGameSets(
  collegeId: string,
  userId: string,
): Promise<GamePlayListResponse> {
  const scope = createTenantScope(collegeId);
  const sets = await GameSetModel.find(scope.filter({ isPublished: true })).sort({
    createdAt: -1,
    _id: -1,
  });
  if (sets.length === 0) return { items: [] };

  const user = await UserModel.findById(userId).select("orgUnit");
  const studentUnit = user?.orgUnit ? user.orgUnit.toString() : null;
  const units = await OrgUnitModel.find(scope.filter()).select("_id parent");
  const refs = units.map((u) => ({
    id: u._id.toString(),
    parentId: u.parent ? u.parent.toString() : null,
  }));

  const items: GamePlayListItem[] = [];
  for (const s of sets) {
    const targets = (s.orgUnits ?? []).map((u) => u.toString());
    if (targets.length > 0) {
      const allowed = new Set(collectDescendantUnitIds(refs, targets));
      if (!studentUnit || !allowed.has(studentUnit)) continue;
    }
    const used = await countUsedAttempts(userId, s._id);
    items.push(toGamePlayListItem(s, used));
  }
  return { items };
}

// ---------------------------------------------------------------------------
// Operator READ surface (Step 24 G2) — attempt list + cohort report. Gated at
// the route by the SAME guard as the rest of gaming authoring: faculty + the
// GAMING feature (see college-game.routes `author`). Gaming has no separate
// `authoring` sub-capability in force — every authoring route gates on the
// feature itself — so requiring one only here would 403 operators who can
// already author sets (the Step 23 entitlement-wall trap). Read-only over the
// attempts; no scoring/ladder/play-path change.
// ---------------------------------------------------------------------------

type AttemptDoc = HydratedDocument<GameSetAttempt>;

/** Operator ATTEMPT LIST for a set — every BEGUN attempt with its status
 *  (ABANDONED distinguished), composite (only when GRADED), and integrity flags.
 *  Mirror of listSpeakingAttempts. */
export async function listGameSetAttemptsForOperator(
  collegeId: string,
  actor: GameActor,
  gameSetId: string,
): Promise<GameAttemptAdminList> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const gs = await requireTenantGameSet(scope, gameSetId);
  assertManageable(gs, actorScope);

  // Only attempts that actually began (a pre-flight-only parent isn't an attempt).
  const attempts = await GameSetAttemptModel.find({
    gameSet: gs._id,
    begunAt: { $ne: null },
  }).sort({ createdAt: -1 });

  const userIds = attempts.map((a) => a.user).filter(Boolean);
  const users = await UserModel.find({ _id: { $in: userIds } }).select(
    "username rollNumber",
  );
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  const profiles = await ProfileModel.find({ user: { $in: userIds } }).select(
    "user fullName rollNumber",
  );
  const profileByUser = new Map(profiles.map((p) => [p.user.toString(), p]));

  return {
    items: attempts.map((a) => {
      const uid = a.user!.toString();
      const profile = profileByUser.get(uid);
      const user = userById.get(uid);
      return {
        attemptId: a._id.toString(),
        userId: uid,
        userName: profile?.fullName ?? user?.username ?? "unknown",
        rollNumber: profile?.rollNumber ?? user?.rollNumber ?? "",
        status: a.status as GameSetAttemptStatus,
        compositeScore:
          a.status === GameSetAttemptStatus.GRADED ? a.compositeScore : null,
        warningsTriggered: a.warningsTriggered,
        isMalpractice: a.isMalpractice,
        startedAt: (a.startedAt ?? a.createdAt).toISOString(),
        completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      };
    }),
  };
}

/** Pick the row's representative attempt for a student, applying Step 23's retake
 *  policy: the BEST GRADED attempt (max composite) if any; otherwise expose the
 *  in-progress / abandoned state so the operator sees churn without a fake score. */
function pickCohortAttempt(list: AttemptDoc[]): {
  status: GameSetAttemptStatus | null;
  best: AttemptDoc | null;
} {
  if (list.length === 0) return { status: null, best: null };
  const graded = list.filter(
    (a) => a.status === GameSetAttemptStatus.GRADED,
  );
  if (graded.length > 0) {
    const best = graded.reduce((b, a) =>
      a.compositeScore > b.compositeScore ? a : b,
    );
    return { status: GameSetAttemptStatus.GRADED, best };
  }
  if (list.some((a) => a.status === GameSetAttemptStatus.IN_PROGRESS)) {
    return { status: GameSetAttemptStatus.IN_PROGRESS, best: null };
  }
  return { status: GameSetAttemptStatus.ABANDONED, best: null };
}

/**
 * Cohort report: one row per student in the set's cohort (targeted org-units, or
 * the whole college when untargeted — mirror of getCommunicationCohortReport),
 * with PER-GAME columns (the authored games) plus the composite and attempt
 * count. Honesty: a never-attempted student shows null composite + "—" per game
 * (never 0); an in-progress-only student reads in-progress; an abandoned-only one
 * reads abandoned; per-game rawScore is the TRUE unclamped value (may be
 * negative). The row's per-game cells come from the BEST GRADED attempt, mapped
 * back to the authored games via that attempt's pickedIndices (so random_n_of_pool
 * sets map correctly and a game not in that attempt reads "—").
 */
export async function getGameSetCohortReport(
  collegeId: string,
  actor: GameActor,
  gameSetId: string,
): Promise<GameCohortReport> {
  const scope = createTenantScope(collegeId);
  const actorScope = await resolveActorScope(scope, actor);
  const gs = await requireTenantGameSet(scope, gameSetId);
  assertManageable(gs, actorScope);

  const columns = gs.games.map((g, i) => ({
    gameIndex: i,
    gameKey: g.gameKey as GameKey,
  }));

  // Cohort students (mirror communication): college students in the targeted
  // org-units (whole college when untargeted).
  const college = new Types.ObjectId(collegeId);
  const targets = (gs.orgUnits ?? []).map((u) => u.toString());
  const studentFilter: Record<string, unknown> = {
    college,
    role: Role.STUDENT,
    userType: UserType.COLLEGE,
  };
  if (targets.length > 0) {
    const units = await OrgUnitModel.find({ college }).select("_id parent");
    const refs = units.map((u) => ({
      id: u._id.toString(),
      parentId: u.parent ? u.parent.toString() : null,
    }));
    const allowed = collectDescendantUnitIds(refs, targets).map(
      (id) => new Types.ObjectId(id),
    );
    studentFilter.orgUnit = { $in: allowed };
  }
  const students = await UserModel.find(studentFilter).select(
    "username rollNumber",
  );
  const profiles = await ProfileModel.find({
    user: { $in: students.map((s) => s._id) },
  }).select("user fullName rollNumber");
  const profileByUser = new Map(profiles.map((p) => [p.user.toString(), p]));

  // All begun attempts for these students on this set, grouped by user.
  const attempts = await GameSetAttemptModel.find({
    gameSet: gs._id,
    user: { $in: students.map((s) => s._id) },
    begunAt: { $ne: null },
  });
  const attemptsByUser = new Map<string, AttemptDoc[]>();
  for (const a of attempts) {
    const k = a.user!.toString();
    const arr = attemptsByUser.get(k);
    if (arr) arr.push(a);
    else attemptsByUser.set(k, [a]);
  }

  // Per-game raw scores of every BEST attempt, in one query.
  const bestByUser = new Map<string, AttemptDoc>();
  for (const [uid, list] of attemptsByUser) {
    const { best } = pickCohortAttempt(list);
    if (best) bestByUser.set(uid, best);
  }
  const bestIds = [...bestByUser.values()].map((a) => a._id);
  const children = await GameAttemptModel.find({
    parent: { $in: bestIds },
  }).select("parent gameIndex score");
  const childrenByParent = new Map<string, typeof children>();
  for (const c of children) {
    const k = c.parent.toString();
    const arr = childrenByParent.get(k);
    if (arr) arr.push(c);
    else childrenByParent.set(k, [c]);
  }

  const emptyCells = (): GameCohortCell[] =>
    columns.map((col) => ({
      gameIndex: col.gameIndex,
      rawScore: null,
      played: false,
    }));

  const rows: GameCohortRow[] = students.map((student) => {
    const uid = student._id.toString();
    const profile = profileByUser.get(uid);
    const list = attemptsByUser.get(uid) ?? [];
    const { status, best } = pickCohortAttempt(list);

    let cells: GameCohortCell[];
    let compositeScore: number | null = null;
    if (best) {
      compositeScore = best.compositeScore;
      // Map this attempt's children back to AUTHORED game columns via the
      // frozen pickedIndices — a game not in the attempt stays "—".
      const scoreByAuthored = new Map<number, number>();
      for (const c of childrenByParent.get(best._id.toString()) ?? []) {
        const authoredIndex = best.pickedIndices[c.gameIndex];
        if (authoredIndex != null) scoreByAuthored.set(authoredIndex, c.score);
      }
      cells = columns.map((col) => ({
        gameIndex: col.gameIndex,
        rawScore: scoreByAuthored.has(col.gameIndex)
          ? scoreByAuthored.get(col.gameIndex)!
          : null,
        played: scoreByAuthored.has(col.gameIndex),
      }));
    } else {
      cells = emptyCells();
    }

    return {
      userId: uid,
      userName: profile?.fullName ?? student.username,
      rollNumber: profile?.rollNumber ?? student.rollNumber ?? "",
      status,
      compositeScore,
      attemptCount: list.length,
      cells,
    };
  });

  // Stable ordering (roll then name) for a deterministic export.
  rows.sort(
    (a, b) =>
      a.rollNumber.localeCompare(b.rollNumber) ||
      a.userName.localeCompare(b.userName),
  );

  return {
    id: gs._id.toString(),
    title: gs.title,
    games: columns,
    rows,
  };
}
