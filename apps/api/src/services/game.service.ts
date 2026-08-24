/**
 * Gaming engine — server-authoritative, adaptive game-round lifecycle. Mirrors
 * the exam engine's shape (Caller identity, loadAndAuthorize, server-set clocks,
 * an atomic terminal claim) but serves an UNBOUNDED, ADAPTIVE stream instead of
 * a fixed question list: unlimited questions inside each game's clock, difficulty
 * that steps up on a correct answer and down on a wrong one, marks that vary by
 * tier, and NO negative marking.
 *
 * All scoring/ladder/generation logic is PURE and lives in @codeapt/shared
 * (GAME_REGISTRY, applyLadderOutcome, the seeded PRNG). This layer is I/O only:
 * it persists instances, replays submissions through the module, and never lets
 * the client compute or supply a score.
 */
import { randomUUID } from "node:crypto";

import {
  EXAM_MAX_WARNINGS,
  GAME_MAX_PROBES_PER_ITEM,
  GAME_MAX_SERVED_ITEMS,
  GAME_REGISTRY,
  GameAttemptStatus,
  GameErrorCode,
  GameOutcome,
  GameSelectionMode,
  GameSetAttemptStatus,
  TopicType,
  applyLadderOutcome,
  collectDescendantUnitIds,
  createRng,
  isCourseGranted,
  isPlatformAdmin,
  rngShuffle,
  type AdvanceGameResponse,
  type AnswerGameItemRequest,
  type AnswerGameItemResponse,
  type AnyGameModule,
  type BeginGameResponse,
  type GameDifficulty as GameDifficultyT,
  type GameInfo,
  type GameItemView,
  type GameExplanationResponse,
  type GameKey,
  type GameResult,
  type LadderOutcome,
  type ProbeGameItemRequest,
  type ProbeGameItemResponse,
  type RecordGameWarningResponse,
  type StartGameSetResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  GameAttemptModel,
  GameSetAttemptCounterModel,
  GameSetAttemptModel,
  GameSetModel,
  type GameAttempt,
  type GameSet,
  type GameSetAttempt,
} from "../models/game.model.js";
import { CollegeModel } from "../models/college.model.js";
import {
  EnrollmentModel,
  ModuleModel,
  TopicModel,
} from "../models/curriculum.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { UserModel } from "../models/user.model.js";
import { normalizeEntitlements } from "./college.service.js";

type GameSetDoc = HydratedDocument<GameSet>;
type ParentDoc = HydratedDocument<GameSetAttempt>;
type GameAttemptDoc = HydratedDocument<GameAttempt>;
type SpecDoc = GameSet["games"][number];

/** Caller identity for the engine: session user and/or attempt token. */
export interface Caller {
  userId?: string;
  token?: string;
}

const NOT_FOUND = (): AppError =>
  new AppError("Game set not found", 404, GameErrorCode.GAME_SET_NOT_FOUND);
const ATTEMPT_NOT_FOUND = (): AppError =>
  new AppError("Attempt not found", 404, GameErrorCode.ATTEMPT_NOT_FOUND);
const OUT_OF_SCOPE = (msg: string): AppError =>
  new AppError(msg, 403, GameErrorCode.ORG_UNIT_OUT_OF_SCOPE);

/** Server-authoritative remaining seconds from a stored, server-set clock end. */
function remainingSeconds(expiresAt: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}

function isExpired(ga: GameAttemptDoc): boolean {
  return Date.now() > ga.expiresAt.getTime();
}

function answeredCount(ga: GameAttemptDoc): number {
  return ga.served.filter((s) => s.outcome != null).length;
}

function reachedMax(ga: GameAttemptDoc): boolean {
  return ga.maxQuestions > 0 && answeredCount(ga) >= ga.maxQuestions;
}

/** Absolute safety ceiling on served items, independent of maxQuestions. */
function reachedCap(ga: GameAttemptDoc): boolean {
  return ga.served.length >= GAME_MAX_SERVED_ITEMS;
}

/** Effective per-item seconds: the GameSet practice override wins when set (>0);
 * otherwise the module's intrinsic default. A 0 override cannot REMOVE an
 * intrinsic limit — it just falls back to the module default. null = no limit. */
function effectiveItemSeconds(
  module: AnyGameModule,
  practiceOverride: number,
): number | null {
  if (practiceOverride && practiceOverride > 0) return practiceOverride;
  return module.defaultItemSeconds;
}

/** Whether this served item's own (intrinsic) deadline has passed. */
function itemExpired(item: GameAttempt["served"][number], now: Date): boolean {
  return item.itemExpiresAt != null && now.getTime() > item.itemExpiresAt.getTime();
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Authorization FLOOR for playing a game set — the full access matrix. Mirrors
 * `assertCanTakeExam` (exam.service) and REUSES its predicates rather than
 * reimplementing them. A GameSet is exactly one of three shapes:
 *
 *   1. TENANT (`college != null`, topic null): a college's own set. Must be a
 *      student of THAT college, set published, and (if targeted) in a targeted
 *      org-unit. Another college's member or a B2C user → 404; cohort mismatch
 *      → 403. Byte-for-byte the exam tenant branch. GAMING is the college's own
 *      authoring/consumption feature (gated at the /c/:slug route).
 *   2. COURSE-ATTACHED (`college == null`, `topic != null`): platform content
 *      mapped to a curriculum GAME topic. Reachable two ways:
 *        - B2C learner: an active enrollment in the subject owning the topic —
 *          the SAME inverted-`listExamsForUser` chain assertCanTakeExam uses
 *          (Topic→Module→Subject→Enrollment.exists), only topicType == GAME.
 *        - college student: their college has been GRANTED the course (subject)
 *          owning the topic — reusing `isCourseGranted` over the college's
 *          normalized entitlements. NOTE: this path does NOT require
 *          CollegeFeature.GAMING — the grant IS the authorization; GAMING gates
 *          AUTHORING, not consumption of granted platform content.
 *   3. PLATFORM-INTERNAL (`college == null`, topic null): dev/probe sets.
 *      Platform admins only; anyone else → 404.
 */
export async function assertCanPlayGameSet(
  userId: string,
  gameSet: GameSetDoc,
): Promise<void> {
  // 1. TENANT set.
  if (gameSet.college) {
    const user = await UserModel.findById(userId).select("college orgUnit");
    if (
      !user?.college ||
      user.college.toString() !== gameSet.college.toString() ||
      !gameSet.isPublished
    ) {
      throw NOT_FOUND();
    }
    const targets = (gameSet.orgUnits ?? []).map((u) => u.toString());
    if (targets.length > 0) {
      const units = await OrgUnitModel.find({
        college: gameSet.college,
      }).select("_id parent");
      const refs = units.map((u) => ({
        id: u._id.toString(),
        parentId: u.parent ? u.parent.toString() : null,
      }));
      const studentUnit = user.orgUnit ? user.orgUnit.toString() : null;
      const allowed = new Set(collectDescendantUnitIds(refs, targets));
      if (!studentUnit || !allowed.has(studentUnit)) {
        throw OUT_OF_SCOPE("This game set is not assigned to your cohort");
      }
    }
    return;
  }

  // 2. COURSE-ATTACHED set (college == null, topic set).
  if (gameSet.topic) {
    // Resolve the owning subject via the exam engine's chain: an attached topic
    // must be a GAME topic to be reachable, exactly as assertCanTakeExam
    // requires topicType == EXAM.
    const topic = await TopicModel.findById(gameSet.topic).select(
      "module topicType",
    );
    const mod =
      topic && topic.topicType === TopicType.GAME
        ? await ModuleModel.findById(topic.module).select("subject")
        : null;
    if (!mod) throw NOT_FOUND();
    const subjectId = mod.subject.toString();

    // B2C: reuse listExamsForUser's predicate, inverted — an active enrollment
    // in the owning subject.
    const enrolled = await EnrollmentModel.exists({
      user: userId,
      subject: mod.subject,
    });
    if (enrolled) return;

    // College student: their college has GRANTED the owning course. Reuse
    // isCourseGranted over the college's normalized entitlements — the same
    // grant check the tenant course surface uses. No GAMING feature required.
    const user = await UserModel.findById(userId).select("college");
    if (user?.college) {
      const college = await CollegeModel.findById(user.college);
      if (college && isCourseGranted(normalizeEntitlements(college), subjectId)) {
        return;
      }
    }
    throw NOT_FOUND();
  }

  // 3. PLATFORM-INTERNAL set (college == null, topic == null).
  const user = await UserModel.findById(userId).select("role");
  if (!user || !isPlatformAdmin(user.role)) throw NOT_FOUND();
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function requireGameSet(gameSetId: string): Promise<GameSetDoc> {
  if (!Types.ObjectId.isValid(gameSetId)) throw NOT_FOUND();
  const gameSet = await GameSetModel.findById(gameSetId);
  if (!gameSet) throw NOT_FOUND();
  return gameSet;
}

async function loadAndAuthorize(
  attemptId: string,
  caller: Caller,
): Promise<ParentDoc> {
  if (!Types.ObjectId.isValid(attemptId)) throw ATTEMPT_NOT_FOUND();
  const attempt = await GameSetAttemptModel.findById(attemptId);
  if (!attempt) throw ATTEMPT_NOT_FOUND();
  const tokenOk = !!caller.token && caller.token === attempt.attemptToken;
  const ownerOk =
    !!caller.userId &&
    attempt.user != null &&
    attempt.user.toString() === caller.userId;
  if (!tokenOk && !ownerOk) {
    throw new AppError(
      "You are not authorized for this attempt",
      403,
      GameErrorCode.NOT_AUTHORIZED,
    );
  }
  return attempt;
}

async function currentGameAttempt(parent: ParentDoc): Promise<GameAttemptDoc> {
  const ga = await GameAttemptModel.findOne({
    parent: parent._id,
    gameIndex: parent.currentIndex,
  });
  if (!ga) throw ATTEMPT_NOT_FOUND();
  return ga;
}

// ---------------------------------------------------------------------------
// Serving + views
// ---------------------------------------------------------------------------

/** Append a freshly-generated item at the current ladder difficulty (mutates,
 * does not save). The full instance (with solution) is denormalized on the
 * served entry; scoring later replays against THIS stored instance. */
function serveNextItem(ga: GameAttemptDoc): void {
  const module = GAME_REGISTRY[ga.gameKey as GameKey];
  const index = ga.served.length;
  const difficulty = (ga.ladder as { difficulty: GameDifficultyT }).difficulty;
  const instance = module.generate(`${ga.seed}:${index}`, difficulty);
  const now = Date.now();
  const itemSeconds = (ga.itemSeconds as number | null | undefined) ?? null;
  // Interactive games start with per-item discovered state, seeded from the
  // frozen per-game config (e.g. door_key's onWallHit).
  const probeState =
    module.interactive && module.probe
      ? module.probe.init(
          instance,
          (ga.config as Record<string, unknown> | undefined) ?? {},
        )
      : null;
  ga.served.push({
    index,
    difficulty,
    marks: 0,
    instance,
    submission: null,
    probeState,
    itemExpiresAt: itemSeconds != null ? new Date(now + itemSeconds * 1000) : null,
    servedAt: new Date(now),
    answeredAt: null,
    latencyMs: null,
  } as GameAttempt["served"][number]);
  ga.questionsServed = ga.served.length;
}

function buildItemView(
  parent: ParentDoc,
  ga: GameAttemptDoc,
  item: GameAttempt["served"][number],
): GameItemView {
  const module = GAME_REGISTRY[ga.gameKey as GameKey];
  return {
    attemptId: parent._id.toString(),
    gameKey: ga.gameKey as GameKey,
    gameIndex: ga.gameIndex,
    itemIndex: item.index,
    difficulty: item.difficulty as GameDifficultyT,
    // The module strips the solution — the client never receives it. For an
    // interactive game we project the CURRENT discovered state via probe.view so
    // a resume (beginGame re-serving a pending item) reflects real progress and
    // never re-reveals a one-time exposure (grid_challenge's highlight); for a
    // FRESH item probe.view(instance, initState) equals toClientView, so door_key
    // and the fresh-serve path are unchanged. One-shot games use toClientView.
    view:
      module.interactive && module.probe && item.probeState != null
        ? module.probe.view(item.instance, item.probeState)
        : module.toClientView(item.instance),
    allowSkip: ga.allowSkip,
    remainingSeconds: remainingSeconds(ga.expiresAt),
    perQuestionTimerSeconds: parent.perQuestionTimerSeconds,
    itemRemainingSeconds: item.itemExpiresAt
      ? remainingSeconds(item.itemExpiresAt)
      : null,
    interactive: module.interactive,
    instantFeedback: parent.instantFeedback,
  };
}

/** Create the child GameAttempt for one game in the sequence + serve its first
 * item. The clock end is server-set HERE (never trusted from the client). */
async function createGameAttempt(
  parent: ParentDoc,
  gameIndex: number,
  spec: SpecDoc,
): Promise<GameAttemptDoc> {
  // Skip is clamped by the module: a game whose mechanics forbid skipping
  // (allowSkipDefault:false, e.g. switch_challenge) can NEVER be skipped, even
  // if an authored GameSpec set allowSkip:true. The toggle can only RESTRICT.
  const gameModule = GAME_REGISTRY[spec.gameKey as GameKey];
  const ga = new GameAttemptModel({
    parent: parent._id,
    gameIndex,
    gameKey: spec.gameKey,
    seed: randomUUID(),
    allowSkip: spec.allowSkip && gameModule.allowSkipDefault,
    maxQuestions: spec.maxQuestions,
    // Freeze the effective per-item timer and the per-game interactive config so
    // the hot answer/probe paths never re-read the authored set.
    itemSeconds: effectiveItemSeconds(gameModule, parent.perQuestionTimerSeconds),
    config: { onWallHit: (spec as { onWallHit?: string }).onWallHit ?? "block" },
    ladder: { difficulty: spec.startingDifficulty },
    served: [],
    expiresAt: new Date(Date.now() + spec.durationSeconds * 1000),
    status: GameAttemptStatus.IN_PROGRESS,
  });
  serveNextItem(ga);
  await ga.save();
  return ga;
}

// ---------------------------------------------------------------------------
// Play lifecycle
// ---------------------------------------------------------------------------

export async function startGameSetAttempt(
  userId: string,
  gameSetId: string,
  serve = true,
): Promise<StartGameSetResponse> {
  const gameSet = await requireGameSet(gameSetId);
  await assertCanPlayGameSet(userId, gameSet);

  const games = gameSet.games;
  if (games.length === 0) {
    throw new AppError(
      "This game set has no games",
      400,
      GameErrorCode.GAME_SET_NOT_PUBLISHABLE,
    );
  }

  // Attempt-limit enforcement (0 = unlimited). Mirrors exam.service's ordering:
  // the limit is checked BEFORE the counter is incremented, so a REJECTED start
  // never consumes an attempt. Runs AFTER assertCanPlayGameSet, so an
  // auth-rejected start doesn't touch the counter either.
  let attemptsRemaining: number | null = null;
  if (gameSet.maxAttempts !== 0) {
    const counter = await GameSetAttemptCounterModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId), gameSet: gameSet._id },
      { $setOnInsert: { attemptCount: 0 } },
      { upsert: true, new: true },
    );
    if (counter.attemptCount >= gameSet.maxAttempts) {
      throw new AppError(
        "You have reached the attempt limit for this game set",
        409,
        GameErrorCode.ATTEMPT_LIMIT_REACHED,
      );
    }
    counter.attemptCount += 1;
    await counter.save();
    attemptsRemaining = gameSet.maxAttempts - counter.attemptCount;
  }

  // Resolve + FREEZE the sequence. random_n_of_pool picks ONCE here.
  let pickedIndices: number[];
  if (gameSet.selectionMode === GameSelectionMode.RANDOM_N_OF_POOL) {
    const n = gameSet.pickCount ?? games.length;
    const all = games.map((_g, i) => i);
    pickedIndices = rngShuffle(createRng(randomUUID()), all).slice(0, n);
  } else {
    pickedIndices = games.map((_g, i) => i);
  }
  const sequence = pickedIndices.map((i) => games[i]!.gameKey);

  const parent = await GameSetAttemptModel.create({
    college: gameSet.college ?? null,
    user: new Types.ObjectId(userId),
    gameSet: gameSet._id,
    status: GameSetAttemptStatus.IN_PROGRESS,
    sequence,
    pickedIndices,
    currentIndex: 0,
    compositeScore: 0,
    attemptToken: randomUUID(),
    startedAt: new Date(),
    perQuestionTimerSeconds: gameSet.perQuestionTimerSeconds,
    instantFeedback: gameSet.instantFeedback,
  });

  // A1: the deferred (UI) flow passes serve:false — return the first game's
  // pre-flight INFO only, with NO child created and NO clock started, so the
  // tutorial runs against a stopped clock; `begin` serves + starts the clock.
  // serve:true (the default — tests / quick-start) also serves the first item.
  let item: GameItemView | null = null;
  if (serve) {
    const firstSpec = games[pickedIndices[0]!]!;
    const ga = await createGameAttempt(parent, 0, firstSpec);
    item = buildItemView(parent, ga, ga.served[0]!);
  }
  return {
    attemptId: parent._id.toString(),
    attemptToken: parent.attemptToken,
    gameSetId: gameSet._id.toString(),
    sequence: sequence as GameKey[],
    totalGames: sequence.length,
    attemptsRemaining,
    firstGame: gameInfoFor(gameSet, parent, 0),
    item,
  };
}

/** Pre-flight info for a game in the frozen sequence, WITHOUT serving it (no
 * clock started). Derived from the authored spec + the module — operator-safe. */
function gameInfoFor(
  gameSet: GameSetDoc,
  parent: ParentDoc,
  gameIndex: number,
): GameInfo {
  const spec = gameSet.games[parent.pickedIndices[gameIndex]!]!;
  const gameModule = GAME_REGISTRY[spec.gameKey as GameKey];
  return {
    gameKey: spec.gameKey as GameKey,
    gameIndex,
    allowSkip: spec.allowSkip && gameModule.allowSkipDefault,
    durationSeconds: spec.durationSeconds,
    itemSeconds: effectiveItemSeconds(gameModule, parent.perQuestionTimerSeconds),
    instantFeedback: parent.instantFeedback,
    maxQuestions: spec.maxQuestions,
  };
}

/**
 * Serve the current game's first item and START its clock (A1). The clock end
 * (`expiresAt`) is server-set inside createGameAttempt at THIS moment, so the
 * countdown begins exactly when the player leaves the tutorial — never at start.
 *
 * UN-GAMEABLE: `expiresAt` is server-computed from the server's own now; the
 * client can neither set nor extend it. Withholding `begin` only delays SEEING
 * the puzzle (no item is served until begin), so it grants no time advantage.
 * And begin is IDEMPOTENT — once the child exists, a re-call returns the current
 * item and does NOT reset the clock, so it cannot be used to buy more time.
 */
export async function beginGame(
  attemptId: string,
  caller: Caller,
): Promise<BeginGameResponse> {
  const parent = await loadAndAuthorize(attemptId, caller);
  if (parent.status === GameSetAttemptStatus.GRADED) {
    throw new AppError(
      "This attempt is already finished",
      409,
      GameErrorCode.ALREADY_GRADED,
    );
  }
  const existing = await GameAttemptModel.findOne({
    parent: parent._id,
    gameIndex: parent.currentIndex,
  });
  if (existing) {
    // Idempotent — return the current pending (or last) item, clock untouched.
    const pending =
      existing.served.find((s) => s.outcome == null) ??
      existing.served[existing.served.length - 1]!;
    return { item: buildItemView(parent, existing, pending) };
  }
  const gameSet = await requireGameSet(parent.gameSet.toString());
  const spec = gameSet.games[parent.pickedIndices[parent.currentIndex]!]!;
  const ga = await createGameAttempt(parent, parent.currentIndex, spec);
  return { item: buildItemView(parent, ga, ga.served[0]!) };
}

export async function answerGameItem(
  attemptId: string,
  caller: Caller,
  input: AnswerGameItemRequest,
): Promise<AnswerGameItemResponse> {
  const parent = await loadAndAuthorize(attemptId, caller);
  if (parent.status === GameSetAttemptStatus.GRADED) {
    throw new AppError(
      "This attempt is already finished",
      409,
      GameErrorCode.ALREADY_GRADED,
    );
  }
  const ga = await currentGameAttempt(parent);

  // The item is addressed on the CURRENT game only — an item from another game
  // (or another user's attempt) is unreachable here (currentIndex + ownership).
  if (input.itemIndex < 0 || input.itemIndex >= ga.served.length) {
    throw new AppError(
      "No such item on the current game",
      404,
      GameErrorCode.ITEM_NOT_FOUND,
    );
  }
  const item = ga.served[input.itemIndex]!;

  // Idempotent: answering the same item twice returns the stored outcome and
  // never double-counts marks.
  if (item.outcome != null) {
    return buildAnswerResponse(parent, ga, item, false);
  }

  const now = new Date();
  const module = GAME_REGISTRY[ga.gameKey as GameKey];
  let outcome: GameOutcome;
  if (isExpired(ga) || itemExpired(item, now)) {
    // The game clock OR this item's intrinsic per-item timer ran out (both
    // server-authoritative) — recorded as expired, no marks.
    outcome = GameOutcome.EXPIRED;
  } else if (input.action === "expire") {
    // A3: the client's clock hit zero but the SERVER's has NOT. Do NOT record a
    // bogus `wrong` (an empty submission would fail the schema and step the
    // ladder DOWN) — the item is still live. Reject so the client keeps playing;
    // the server clock is the only authority on expiry.
    throw new AppError(
      "This item has not expired yet",
      409,
      GameErrorCode.GAME_NOT_EXPIRED,
    );
  } else if (input.action === "skip") {
    if (!ga.allowSkip) {
      throw new AppError(
        "Skip is not allowed for this game",
        400,
        GameErrorCode.SKIP_NOT_ALLOWED,
      );
    }
    outcome = GameOutcome.SKIPPED;
  } else {
    // Interactive games are NOT solved in one shot — they are played move-by-
    // move via the probe endpoint. Reject a one-shot answer for them. (One-shot
    // games never reach this branch, so their path is completely unchanged.)
    if (module.interactive) {
      throw new AppError(
        "This game is played move-by-move; use the probe endpoint",
        400,
        GameErrorCode.NOT_ONE_SHOT,
      );
    }
    // Validate the submission against the game's schema BEFORE replay. A
    // malformed/oversized payload is a FAILED answer (scored wrong), never a
    // 500 and never a 400 — a 400 would let a client probe for the schema shape
    // and stall the clock by retrying. The server computes correctness by
    // REPLAYING the validated submission; any client-supplied "score" is ignored.
    const parsed = module.submissionSchema.safeParse(input.submission);
    outcome = parsed.success
      ? module.score(item.instance, parsed.data).correct
        ? GameOutcome.CORRECT
        : GameOutcome.WRONG
      : GameOutcome.WRONG;
  }

  item.submission = input.action === "skip" ? null : (input.submission ?? null);
  const gameComplete = finalizeItem(ga, item, outcome, now);
  // Mixed paths (ladder + the served instances/submissions) need explicit marks.
  ga.markModified("ladder");
  ga.markModified("served");
  await ga.save();

  return buildAnswerResponse(parent, ga, item, gameComplete);
}

/**
 * Record an item's outcome, drive the ladder, and either serve the next item or
 * complete the game. Shared by the one-shot answer path and the interactive
 * probe path so both apply the SAME scoring/laddering/completion rules. The
 * caller sets `item.submission` and persists (markModified + save).
 */
function finalizeItem(
  ga: GameAttemptDoc,
  item: GameAttempt["served"][number],
  outcome: GameOutcome,
  now: Date,
): boolean {
  // Custom-scored interactive games (grid_challenge) compute their OWN marks —
  // which MAY be negative — from the final probe state on RESOLUTION; the ladder
  // still drives difficulty (via correct/wrong) but not the marks. Every other
  // game leaves `settle` undefined and uses the ladder's tier marks exactly as
  // before, so no game but this one can ever score below zero.
  const module = GAME_REGISTRY[ga.gameKey as GameKey];
  const custom =
    module.settle &&
    item.probeState != null &&
    outcome !== GameOutcome.EXPIRED &&
    outcome !== GameOutcome.SKIPPED
      ? module.settle(item.instance, item.probeState)
      : null;
  const recordedOutcome = custom
    ? custom.correct
      ? GameOutcome.CORRECT
      : GameOutcome.WRONG
    : outcome;
  const step = applyLadderOutcome(
    { difficulty: item.difficulty as GameDifficultyT },
    recordedOutcome as LadderOutcome,
  );
  const marksAwarded = custom ? custom.marks : step.marksAwarded;
  item.outcome = recordedOutcome;
  item.marks = marksAwarded;
  item.answeredAt = now;
  item.latencyMs = now.getTime() - item.servedAt.getTime();

  if (recordedOutcome !== GameOutcome.EXPIRED) ga.questionsAttempted += 1;
  if (recordedOutcome === GameOutcome.CORRECT) ga.questionsCorrect += 1;
  ga.score += marksAwarded;
  ga.ladder = { difficulty: step.next.difficulty };

  const gameComplete =
    recordedOutcome === GameOutcome.EXPIRED || reachedMax(ga) || reachedCap(ga);
  if (gameComplete) {
    ga.status = GameAttemptStatus.COMPLETE;
  } else {
    serveNextItem(ga);
  }
  return gameComplete;
}

function buildAnswerResponse(
  parent: ParentDoc,
  ga: GameAttemptDoc,
  item: GameAttempt["served"][number],
  gameComplete: boolean,
): AnswerGameItemResponse {
  // The "next" item is the last served entry that hasn't been answered yet.
  const pending = ga.served.find((s) => s.outcome == null);
  const done = gameComplete || pending == null || ga.status === GameAttemptStatus.COMPLETE;
  return {
    itemIndex: item.index,
    outcome: item.outcome as GameOutcome,
    marksAwarded: item.marks,
    answeredDifficulty: item.difficulty as GameDifficultyT,
    gameScore: ga.score,
    questionsCorrect: ga.questionsCorrect,
    questionsAttempted: ga.questionsAttempted,
    correct: item.outcome === GameOutcome.CORRECT,
    next: done || pending == null ? null : buildItemView(parent, ga, pending),
    gameComplete: done,
  };
}

// ---------------------------------------------------------------------------
// Interactive play (probe) — hidden-information games (door_key)
// ---------------------------------------------------------------------------

/** The stored "submission" for an interactive item: its move history. */
function interactiveSubmission(item: GameAttempt["served"][number]): unknown {
  const state = (item.probeState ?? {}) as { dirs?: number[] };
  return { dirs: state.dirs ?? [] };
}

/**
 * Play ONE move of the current interactive item. The server applies the move
 * against the HIDDEN instance, accumulates discovered state on the served entry
 * (the client never reports its own position), and returns only a REDACTED
 * view. The item resolves `correct` on reaching the goal, or `wrong` on the
 * move cap; the clock / per-item timer resolve it `expired`.
 */
export async function probeGameItem(
  attemptId: string,
  caller: Caller,
  input: ProbeGameItemRequest,
): Promise<ProbeGameItemResponse> {
  const parent = await loadAndAuthorize(attemptId, caller);
  if (parent.status === GameSetAttemptStatus.GRADED) {
    throw new AppError(
      "This attempt is already finished",
      409,
      GameErrorCode.ALREADY_GRADED,
    );
  }
  const ga = await currentGameAttempt(parent);
  const module = GAME_REGISTRY[ga.gameKey as GameKey];

  // A probe against a ONE-SHOT game is an error, not a no-op.
  if (!module.interactive || !module.probe) {
    throw new AppError(
      "This game is not interactive; submit an answer instead",
      400,
      GameErrorCode.NOT_INTERACTIVE,
    );
  }
  if (input.itemIndex < 0 || input.itemIndex >= ga.served.length) {
    throw new AppError(
      "No such item on the current game",
      404,
      GameErrorCode.ITEM_NOT_FOUND,
    );
  }
  const item = ga.served[input.itemIndex]!;

  // Already resolved — return the final redacted view idempotently.
  if (item.outcome != null) {
    return buildProbeResponse(parent, ga, item, true, false);
  }

  const now = new Date();
  // Clock / per-item timer wins before any move is applied.
  if (isExpired(ga) || itemExpired(item, now)) {
    item.submission = interactiveSubmission(item);
    const complete = finalizeItem(ga, item, GameOutcome.EXPIRED, now);
    ga.markModified("ladder");
    ga.markModified("served");
    await ga.save();
    return buildProbeResponse(parent, ga, item, true, complete);
  }

  // Validate ONE move. A malformed probe is a 400 (it locks in no outcome and
  // cannot stall a clock the way a rejected answer could), never a crash.
  const parsed = module.probe.actionSchema.safeParse(input.action);
  if (!parsed.success) {
    throw new AppError("Invalid move", 400, GameErrorCode.INVALID_PROBE);
  }

  const nextState = module.probe.apply(item.instance, item.probeState, parsed.data);
  item.probeState = nextState;
  const moves = module.probe.movesUsed(nextState);

  let resolvedOutcome: GameOutcome | null = null;
  if (module.probe.resolved(item.instance, nextState)) {
    resolvedOutcome = GameOutcome.CORRECT;
  } else if (moves >= GAME_MAX_PROBES_PER_ITEM) {
    resolvedOutcome = GameOutcome.WRONG; // ran out of moves
  }

  if (resolvedOutcome != null) {
    item.submission = interactiveSubmission(item);
    const complete = finalizeItem(ga, item, resolvedOutcome, now);
    ga.markModified("ladder");
    ga.markModified("served");
    await ga.save();
    return buildProbeResponse(parent, ga, item, true, complete);
  }

  // Unresolved — persist the discovered state and return the redacted view.
  ga.markModified("served");
  await ga.save();
  return buildProbeResponse(parent, ga, item, false, false);
}

function buildProbeResponse(
  parent: ParentDoc,
  ga: GameAttemptDoc,
  item: GameAttempt["served"][number],
  resolved: boolean,
  gameComplete: boolean,
): ProbeGameItemResponse {
  const module = GAME_REGISTRY[ga.gameKey as GameKey];
  const view = module.probe!.view(item.instance, item.probeState);
  const done = gameComplete || ga.status === GameAttemptStatus.COMPLETE;
  const pending = ga.served.find((s) => s.outcome == null);
  return {
    itemIndex: item.index,
    view,
    movesUsed: module.probe!.movesUsed(item.probeState),
    resolved,
    outcome: resolved ? (item.outcome as GameOutcome) : null,
    marksAwarded: resolved ? item.marks : null,
    gameScore: ga.score,
    next:
      resolved && !done && pending != null
        ? buildItemView(parent, ga, pending)
        : null,
    gameComplete: resolved ? done : false,
  };
}

/**
 * PRACTICE-mode reveal. Gated SERVER-SIDE on a distinct code path: only when the
 * attempt's `instantFeedback` is on AND the item is already answered. Delegates
 * to the module's `explain`, which MAY reveal the solution (never on the answer
 * response, only here).
 */
export async function explainGameItem(
  attemptId: string,
  caller: Caller,
  itemIndex: number,
): Promise<GameExplanationResponse> {
  const parent = await loadAndAuthorize(attemptId, caller);
  if (!parent.instantFeedback) {
    throw new AppError(
      "Explanations are only available in practice mode",
      403,
      GameErrorCode.PRACTICE_MODE_OFF,
    );
  }
  const ga = await currentGameAttempt(parent);
  if (itemIndex < 0 || itemIndex >= ga.served.length) {
    throw new AppError(
      "No such item on the current game",
      404,
      GameErrorCode.ITEM_NOT_FOUND,
    );
  }
  const item = ga.served[itemIndex]!;
  if (item.outcome == null) {
    // The reveal is post-answer only — never before the answer is locked.
    throw new AppError(
      "Answer the item before revealing the explanation",
      409,
      GameErrorCode.ITEM_NOT_ANSWERED,
    );
  }
  const module = GAME_REGISTRY[ga.gameKey as GameKey];
  const explanation = module.explain(item.instance, item.submission ?? null);
  return {
    itemIndex,
    outcome: item.outcome as GameOutcome,
    solution: explanation.solution,
    note: explanation.note,
  };
}

export async function advanceGame(
  attemptId: string,
  caller: Caller,
  serve = true,
): Promise<AdvanceGameResponse> {
  const parent = await loadAndAuthorize(attemptId, caller);
  if (parent.status === GameSetAttemptStatus.GRADED) {
    throw new AppError(
      "This attempt is already finished",
      409,
      GameErrorCode.ALREADY_GRADED,
    );
  }
  const ga = await currentGameAttempt(parent);

  // Advance only when the current game is genuinely done — complete, its clock
  // expired, or it hit maxQuestions. No going back.
  const doneNow =
    ga.status === GameAttemptStatus.COMPLETE ||
    isExpired(ga) ||
    reachedMax(ga) ||
    reachedCap(ga);
  if (!doneNow) {
    throw new AppError(
      "Finish the current game before advancing",
      409,
      GameErrorCode.GAME_IN_PROGRESS,
    );
  }
  if (ga.status !== GameAttemptStatus.COMPLETE) {
    ga.status = GameAttemptStatus.COMPLETE;
    await ga.save();
  }

  const nextIndex = parent.currentIndex + 1;
  if (nextIndex >= parent.sequence.length) {
    // No further game — the client should call finish.
    return { nextGame: null, item: null, setComplete: true };
  }

  parent.currentIndex = nextIndex;
  await parent.save();

  // A1: serve:false (UI) returns the next game's pre-flight INFO only, deferring
  // the serve + clock to the following `begin`; serve:true also serves it now.
  const gameSet = await requireGameSet(parent.gameSet.toString());
  let item: GameItemView | null = null;
  if (serve) {
    const spec = gameSet.games[parent.pickedIndices[nextIndex]!]!;
    const nextGa = await createGameAttempt(parent, nextIndex, spec);
    item = buildItemView(parent, nextGa, nextGa.served[0]!);
  }
  return {
    nextGame: gameInfoFor(gameSet, parent, nextIndex),
    item,
    setComplete: false,
  };
}

export async function finishGameSet(
  attemptId: string,
  caller: Caller,
): Promise<GameResult> {
  const parent = await loadAndAuthorize(attemptId, caller);
  const games = await GameAttemptModel.find({ parent: parent._id }).sort({
    gameIndex: 1,
  });
  // The composite FLOORS at zero so a disastrous grid_challenge run (its per-game
  // score can be negative under +3/-1) can't drag the whole set below zero. The
  // per-game raw scores are stored UNFLOORED on each GameAttempt and returned in
  // `games[]` below, so an operator still sees a true -4 (guessed wildly) distinct
  // from a 0 (attempted nothing).
  const rawComposite = games.reduce((sum, g) => sum + g.score, 0);
  const composite = Math.max(0, rawComposite);

  // Atomic IN_PROGRESS → GRADED — only the first finisher writes the composite.
  const claimed = await GameSetAttemptModel.findOneAndUpdate(
    { _id: parent._id, status: GameSetAttemptStatus.IN_PROGRESS },
    {
      $set: {
        status: GameSetAttemptStatus.GRADED,
        compositeScore: composite,
        completedAt: new Date(),
      },
    },
    { new: true },
  );
  const fresh = claimed ?? (await GameSetAttemptModel.findById(parent._id))!;

  return {
    status: fresh.status as GameResult["status"],
    compositeScore: fresh.compositeScore,
    games: games.map((g) => ({
      gameKey: g.gameKey as GameKey,
      gameIndex: g.gameIndex,
      score: g.score,
      questionsServed: g.questionsServed,
      questionsAttempted: g.questionsAttempted,
      questionsCorrect: g.questionsCorrect,
    })),
  };
}

/**
 * A4: record one proctoring warning on the attempt, mirroring the exam warning
 * route and reusing EXAM_MAX_WARNINGS. A gaming round is a SCORED, attempt-
 * limited assessment like an exam, so it gets the same integrity policy: past
 * the threshold the attempt is flagged malpractice AND force-finished (whatever
 * has been scored is committed), exactly as an exam auto-submits. Counts live on
 * the parent GameSetAttempt (the previously capture-only fields).
 */
export async function recordGameWarning(
  attemptId: string,
  caller: Caller,
): Promise<RecordGameWarningResponse> {
  const parent = await loadAndAuthorize(attemptId, caller);
  // Already finished (incl. a prior force-finish) — report the frozen counts.
  if (parent.status === GameSetAttemptStatus.GRADED) {
    return {
      warningsTriggered: parent.warningsTriggered,
      isMalpractice: parent.isMalpractice,
      autoFinished: true,
    };
  }
  parent.warningsTriggered += 1;
  parent.isMalpractice = parent.warningsTriggered > EXAM_MAX_WARNINGS;
  await parent.save();

  let autoFinished = false;
  if (parent.isMalpractice) {
    await finishGameSet(attemptId, caller); // atomic IN_PROGRESS → GRADED
    autoFinished = true;
  }
  return {
    warningsTriggered: parent.warningsTriggered,
    isMalpractice: parent.isMalpractice,
    autoFinished,
  };
}
