/**
 * Platform-admin GameSet authoring (college:null sets). Standalone documents
 * (unlike exams, they are not keyed by a curriculum topic). Also exports the
 * shared serializers + games-builder the college authoring service reuses, so
 * both surfaces produce an identical GameSetDetail shape.
 */
import {
  GameErrorCode,
  GameSelectionMode,
  TopicType,
  type GameKey,
  type GamePlayListItem,
  type GameSetDetail,
  type GameSetListItem,
  type GameSetListResponse,
  type GameSetUpdate,
  type GameSetUpsert,
  type GameSpecInput,
  type GameTopicListResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  ModuleModel,
  SubjectModel,
  TopicModel,
} from "../models/curriculum.model.js";
import {
  GameSetAttemptModel,
  GameSetModel,
  type GameSet,
} from "../models/game.model.js";

type GameSetDoc = HydratedDocument<GameSet>;

const NOT_FOUND = (): AppError =>
  new AppError("Game set not found", 404, "GAME_SET_NOT_FOUND");

/**
 * Validate a curriculum topic for a COURSE-ATTACHED set: it must exist, be a
 * GAME topic, and not already own a game set (the partial unique index is the
 * hard backstop; this gives a clean error first). Returns its ObjectId.
 */
export async function resolveGameTopic(
  topicId: string,
  excludeSetId?: Types.ObjectId,
): Promise<Types.ObjectId> {
  if (!Types.ObjectId.isValid(topicId)) {
    throw new AppError("Topic not found", 404, GameErrorCode.TOPIC_NOT_FOUND);
  }
  const topic = await TopicModel.findById(topicId).select("topicType");
  if (!topic || topic.topicType !== TopicType.GAME) {
    throw new AppError(
      "A game set can only attach to a GAME topic",
      400,
      GameErrorCode.TOPIC_NOT_GAME,
    );
  }
  // The topic may already be attached to ANOTHER set (one set per topic). When
  // re-saving the set that already owns it, exclude itself so it's not a 409.
  const existing = await GameSetModel.findOne({
    topic: topic._id,
    ...(excludeSetId ? { _id: { $ne: excludeSetId } } : {}),
  }).select("_id");
  if (existing) {
    throw new AppError(
      "That topic already has a game set",
      409,
      GameErrorCode.TOPIC_ALREADY_ATTACHED,
    );
  }
  return topic._id;
}

/**
 * Every curriculum GAME topic, for the course-attach picker (platform authoring).
 * Carries the Subject › Module › Topic path for a readable label and an
 * `attached` flag so the UI can disable topics that already own a set (the same
 * rule {@link resolveGameTopic} enforces server-side). Sorted by that path.
 */
export async function listGameTopics(): Promise<GameTopicListResponse> {
  const topics = await TopicModel.find({ topicType: TopicType.GAME })
    .select("_id name module")
    .lean();
  if (topics.length === 0) return { items: [] };

  const modules = await ModuleModel.find({
    _id: { $in: topics.map((t) => t.module) },
  })
    .select("_id name subject")
    .lean();
  const moduleById = new Map(modules.map((m) => [m._id.toString(), m]));

  const subjects = await SubjectModel.find({
    _id: { $in: modules.map((m) => m.subject) },
  })
    .select("_id name")
    .lean();
  const subjectNameById = new Map(subjects.map((s) => [s._id.toString(), s.name]));

  const attachedSets = await GameSetModel.find({
    topic: { $in: topics.map((t) => t._id) },
  })
    .select("topic")
    .lean();
  const attached = new Set(
    attachedSets.map((g) => g.topic?.toString()).filter(Boolean),
  );

  const items = topics.map((t) => {
    const mod = moduleById.get(t.module.toString());
    return {
      id: t._id.toString(),
      name: t.name,
      moduleName: mod?.name ?? "",
      subjectName: mod ? (subjectNameById.get(mod.subject.toString()) ?? "") : "",
      attached: attached.has(t._id.toString()),
    };
  });
  items.sort((a, b) =>
    `${a.subjectName}${a.moduleName}${a.name}`.localeCompare(
      `${b.subjectName}${b.moduleName}${b.name}`,
    ),
  );
  return { items };
}

/** Shared student-facing projection — operator-safe fields only (no seeds, no
 * per-game internals). `attemptsUsed` comes from the per-user counter; `topicId`
 * is set for course-attached sets, null for tenant-authored ones. */
export function toGamePlayListItem(
  gs: GameSetDoc,
  attemptsUsed: number,
): GamePlayListItem {
  return {
    id: gs._id.toString(),
    title: gs.title,
    description: gs.description,
    games: gs.games.map((g) => ({
      gameKey: g.gameKey as GameKey,
      durationSeconds: g.durationSeconds,
      allowSkip: g.allowSkip,
    })),
    selectionMode: gs.selectionMode as GamePlayListItem["selectionMode"],
    totalGames: gs.games.length,
    perQuestionTimerSeconds: gs.perQuestionTimerSeconds,
    attemptsUsed,
    maxAttempts: gs.maxAttempts,
    topicId: gs.topic ? gs.topic.toString() : null,
  };
}

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
    topic: gs.topic ? gs.topic.toString() : null,
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
    source: (gs.source ?? "manual") as GameSetDetail["source"],
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
    source: (gs.source ?? "manual") as GameSetListItem["source"],
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
  // Platform sets are college:null. An optional topicId makes it course-attached
  // (still college:null) — validated to be a real, unused GAME topic. Omitting
  // it yields a platform-internal set (topic:null).
  const topic = input.topicId ? await resolveGameTopic(input.topicId) : null;
  const gs = await GameSetModel.create({
    college: null,
    topic,
    title: input.title,
    description: input.description,
    games: buildGames(input.games),
    selectionMode: input.selectionMode,
    pickCount: resolvePickCount(input.selectionMode, input.pickCount),
    orgUnits: [], // platform sets aren't org-unit targeted
    perQuestionTimerSeconds: input.perQuestionTimerSeconds,
    instantFeedback: input.instantFeedback,
    maxAttempts: input.maxAttempts,
    source: input.source, // audit trail — "ai_drafted" when created from a draft
    isPublished: false,
  });
  return toGameSetDetail(gs);
}

/**
 * Publish-safety FLOOR, shared by the platform + college publish paths. A
 * published set is visible to students, so it must be playable: at least one
 * game, and a random_n_of_pool set's pickCount must not exceed its pool (an
 * update can leave pickCount > games.length, which would try to pick more games
 * than exist). Enforced in the SERVICE — a UI-only guard is not a guard.
 */
export function assertPublishable(gs: GameSetDoc): void {
  if (gs.games.length === 0) {
    throw new AppError(
      "Add at least one game before publishing",
      400,
      GameErrorCode.GAME_SET_NOT_PUBLISHABLE,
    );
  }
  if (
    gs.selectionMode === GameSelectionMode.RANDOM_N_OF_POOL &&
    (gs.pickCount ?? 0) > gs.games.length
  ) {
    throw new AppError(
      "The pick count exceeds the number of games in the pool",
      400,
      GameErrorCode.GAME_SET_NOT_PUBLISHABLE,
    );
  }
}

/** Delete a set — only a DRAFT with no attempts, so play history is never
 * orphaned and a live set can't vanish under students. */
export async function assertDeletable(gs: GameSetDoc): Promise<void> {
  if (gs.isPublished) {
    throw new AppError(
      "Unpublish the set before deleting it",
      409,
      GameErrorCode.GAME_SET_NOT_PUBLISHABLE,
    );
  }
  const attempts = await GameSetAttemptModel.countDocuments({ gameSet: gs._id });
  if (attempts > 0) {
    throw new AppError(
      "This set has play attempts and cannot be deleted",
      409,
      GameErrorCode.GAME_SET_NOT_PUBLISHABLE,
    );
  }
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
  // Course-attach on edit: undefined = leave as-is; "" = detach; id = (re)attach.
  // Without this the topic was never persisted from an edit, so a set attached
  // after creation never appeared in its course (the reported bug).
  if (input.topicId !== undefined) {
    gs.topic = input.topicId
      ? await resolveGameTopic(input.topicId, gs._id)
      : null;
  }
  await gs.save();
  return toGameSetDetail(gs);
}

export async function setGameSetPublished(
  id: string,
  isPublished: boolean,
): Promise<GameSetDetail> {
  const gs = await requireAdminGameSet(id);
  if (isPublished) assertPublishable(gs);
  gs.isPublished = isPublished;
  await gs.save();
  return toGameSetDetail(gs);
}

export async function deleteGameSet(id: string): Promise<void> {
  const gs = await requireAdminGameSet(id);
  await assertDeletable(gs);
  await GameSetModel.deleteOne({ _id: gs._id });
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

/** Published PLATFORM sets a college may clone as a starting template. Read-only
 * and content-free (list items only) — the clone itself is tenant-scoped. */
export async function listGameSetTemplates(): Promise<GameSetListResponse> {
  const sets = await GameSetModel.find({
    college: null,
    isPublished: true,
  }).sort({ createdAt: -1, _id: -1 });
  return { items: sets.map(toGameSetListItem) };
}
