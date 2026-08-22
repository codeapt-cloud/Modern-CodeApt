/**
 * Platform-admin GameSet authoring (college:null sets). Standalone documents
 * (unlike exams, they are not keyed by a curriculum topic). Also exports the
 * shared serializers + games-builder the college authoring service reuses, so
 * both surfaces produce an identical GameSetDetail shape.
 */
import {
  GameSelectionMode,
  type GameSetDetail,
  type GameSetListItem,
  type GameSetListResponse,
  type GameSetUpdate,
  type GameSetUpsert,
  type GameSpecInput,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { GameSetModel, type GameSet } from "../models/game.model.js";

type GameSetDoc = HydratedDocument<GameSet>;

const NOT_FOUND = (): AppError =>
  new AppError("Game set not found", 404, "GAME_SET_NOT_FOUND");

/** Assign `order` from array position — authoring order IS play order. */
export function buildGames(specs: GameSpecInput[]): GameSet["games"] {
  return specs.map((s, i) => ({
    gameKey: s.gameKey,
    order: i,
    durationSeconds: s.durationSeconds,
    allowSkip: s.allowSkip,
    startingDifficulty: s.startingDifficulty,
    maxQuestions: s.maxQuestions,
    onWallHit: s.onWallHit,
  })) as GameSet["games"];
}

export function toGameSetDetail(gs: GameSetDoc): GameSetDetail {
  return {
    id: gs._id.toString(),
    college: gs.college ? gs.college.toString() : null,
    title: gs.title,
    description: gs.description,
    isPublished: gs.isPublished,
    orgUnits: (gs.orgUnits ?? []).map((u) => u.toString()),
    games: gs.games.map((g) => ({
      gameKey: g.gameKey as GameSpecInput["gameKey"],
      order: g.order,
      durationSeconds: g.durationSeconds,
      allowSkip: g.allowSkip,
      startingDifficulty:
        g.startingDifficulty as GameSpecInput["startingDifficulty"],
      maxQuestions: g.maxQuestions,
      onWallHit: (g.onWallHit ?? "block") as GameSpecInput["onWallHit"],
    })),
    selectionMode: gs.selectionMode as GameSetDetail["selectionMode"],
    pickCount: gs.pickCount ?? null,
    perQuestionTimerSeconds: gs.perQuestionTimerSeconds,
    instantFeedback: gs.instantFeedback,
    maxAttempts: gs.maxAttempts,
    createdAt: (gs.createdAt ?? new Date()).toISOString(),
  };
}

export function toGameSetListItem(gs: GameSetDoc): GameSetListItem {
  return {
    id: gs._id.toString(),
    title: gs.title,
    isPublished: gs.isPublished,
    gameCount: gs.games.length,
    selectionMode: gs.selectionMode as GameSetListItem["selectionMode"],
    createdAt: (gs.createdAt ?? new Date()).toISOString(),
  };
}

/** pickCount is stored only for random_n_of_pool; null otherwise. */
function resolvePickCount(
  mode: GameSetUpsert["selectionMode"],
  pickCount: number | undefined,
): number | null {
  return mode === GameSelectionMode.RANDOM_N_OF_POOL ? (pickCount ?? null) : null;
}

async function requireAdminGameSet(id: string): Promise<GameSetDoc> {
  if (!Types.ObjectId.isValid(id)) throw NOT_FOUND();
  // Platform-admin sets are college:null — never touch a college's set.
  const gs = await GameSetModel.findOne({ _id: id, college: null });
  if (!gs) throw NOT_FOUND();
  return gs;
}

export async function createGameSet(
  input: GameSetUpsert,
): Promise<GameSetDetail> {
  const gs = await GameSetModel.create({
    college: null,
    title: input.title,
    description: input.description,
    games: buildGames(input.games),
    selectionMode: input.selectionMode,
    pickCount: resolvePickCount(input.selectionMode, input.pickCount),
    orgUnits: [], // platform sets aren't org-unit targeted
    perQuestionTimerSeconds: input.perQuestionTimerSeconds,
    instantFeedback: input.instantFeedback,
    maxAttempts: input.maxAttempts,
    isPublished: false,
  });
  return toGameSetDetail(gs);
}

export async function updateGameSet(
  id: string,
  input: GameSetUpdate,
): Promise<GameSetDetail> {
  const gs = await requireAdminGameSet(id);
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
  await gs.save();
  return toGameSetDetail(gs);
}

export async function setGameSetPublished(
  id: string,
  isPublished: boolean,
): Promise<GameSetDetail> {
  const gs = await requireAdminGameSet(id);
  if (isPublished && gs.games.length === 0) {
    throw new AppError(
      "Add at least one game before publishing",
      400,
      "GAME_SET_NOT_PUBLISHABLE",
    );
  }
  gs.isPublished = isPublished;
  await gs.save();
  return toGameSetDetail(gs);
}

export async function listGameSets(): Promise<GameSetListResponse> {
  const sets = await GameSetModel.find({ college: null }).sort({
    createdAt: -1,
    _id: -1,
  });
  return { items: sets.map(toGameSetListItem) };
}

export async function getGameSet(id: string): Promise<GameSetDetail> {
  return toGameSetDetail(await requireAdminGameSet(id));
}
