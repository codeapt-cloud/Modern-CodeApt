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
  type GameSetDetail,
  type GameSetListResponse,
  type GameSetUpdate,
  type GameSetUpsert,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import { GameSetModel, type GameSet } from "../models/game.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import {
  buildGames,
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
  if (isPublished && gs.games.length === 0) {
    throw new AppError(
      "Add at least one game before publishing",
      400,
      GameErrorCode.GAME_SET_NOT_PUBLISHABLE,
    );
  }
  gs.isPublished = isPublished;
  await gs.save();
  return toGameSetDetail(gs);
}
