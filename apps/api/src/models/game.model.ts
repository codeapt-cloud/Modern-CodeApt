/**
 * Gaming engine data model (Step 2). A GameSet is an AUTHORED bundle of 1..N
 * timed games (a 1-game set and a 4-game set are the SAME shape — `games` is
 * just length 1 vs 4). A GameSetAttempt is the parent play record; a GameAttempt
 * is one child per game in the resolved sequence.
 *
 * Tenancy is additive (`college` default null) so a future B2C surface works
 * unchanged, mirroring assessment.model.ts. The generated instance (WITH its
 * solution) is DENORMALIZED onto each served entry rather than regenerated from
 * the seed at scoring time — regenerating would let a future generator tweak
 * silently re-score historical attempts. The instance is server-only; the API
 * never serves it raw (only the module's stripped client view).
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  GAME_DEFAULT_CLOCK_SECONDS,
  GAME_ATTEMPT_STATUS_VALUES,
  GAME_DIFFICULTY_VALUES,
  GAME_KEY_VALUES,
  GAME_OUTCOME_VALUES,
  GAME_SELECTION_MODE_VALUES,
  GAME_SET_ATTEMPT_STATUS_VALUES,
  GameAttemptStatus,
  GameDifficulty,
  GameSelectionMode,
  GameSetAttemptStatus,
} from "@codeapt/shared";

// --- GameSpec (embedded, ordered) -------------------------------------------
const gameSpecSchema = new Schema(
  {
    gameKey: { type: String, enum: GAME_KEY_VALUES, required: true },
    order: { type: Number, default: 0 },
    durationSeconds: {
      type: Number,
      default: GAME_DEFAULT_CLOCK_SECONDS,
      min: 1,
    },
    allowSkip: { type: Boolean, default: true },
    startingDifficulty: {
      type: String,
      enum: GAME_DIFFICULTY_VALUES,
      default: GameDifficulty.EASY,
    },
    // 0 = unlimited questions within the clock.
    maxQuestions: { type: Number, default: 0, min: 0 },
    // Interactive games (door_key): wall-bump behaviour. Default block.
    onWallHit: { type: String, enum: ["block", "reset"], default: "block" },
  },
  { _id: false },
);

// --- GameSet (authored) -----------------------------------------------------
const gameSetSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    // Present ONLY for course-attached sets (college == null): 1:1 with a
    // curriculum Topic (type GAME), mirroring Exam.topic. Absent for tenant sets
    // (college != null) and platform-internal sets. The (college != null &&
    // topic != null) combination is rejected at the service layer.
    topic: { type: Schema.Types.ObjectId, ref: "Topic" },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    isPublished: { type: Boolean, default: false },
    orgUnits: { type: [Schema.Types.ObjectId], ref: "OrgUnit", default: [] },
    // ORDERED, length >= 1 (enforced at the service/zod layer).
    games: { type: [gameSpecSchema], default: [] },
    selectionMode: {
      type: String,
      enum: GAME_SELECTION_MODE_VALUES,
      default: GameSelectionMode.FIXED,
    },
    // Only meaningful for random_n_of_pool ("24 games, system picks 4").
    pickCount: { type: Number, default: null },
    // Practice-mode flags.
    perQuestionTimerSeconds: { type: Number, default: 0, min: 0 },
    instantFeedback: { type: Boolean, default: false },
    // Per-user attempt cap. 1 = single attempt (default); 0 = unlimited.
    maxAttempts: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true },
);
gameSetSchema.index({ college: 1 });
gameSetSchema.index({ college: 1, isPublished: 1 });
// Preserve the 1:1 GameSet↔Topic guarantee for course-attached sets WITHOUT
// constraining topic-less sets — unique only over docs whose `topic` is set.
// Mirrors the Exam.topic partial unique index exactly.
gameSetSchema.index(
  { topic: 1 },
  { unique: true, partialFilterExpression: { topic: { $type: "objectId" } } },
);
export type GameSet = InferSchemaType<typeof gameSetSchema>;
export const GameSetModel = model("GameSet", gameSetSchema);

// --- GameSetAttempt (parent) ------------------------------------------------
const gameSetAttemptSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    gameSet: { type: Schema.Types.ObjectId, ref: "GameSet", required: true },
    status: {
      type: String,
      enum: GAME_SET_ATTEMPT_STATUS_VALUES,
      default: GameSetAttemptStatus.IN_PROGRESS,
    },
    // Resolved gameKeys, FROZEN at start (random_n_of_pool picks once here).
    sequence: { type: [String], default: [] },
    // For each position in `sequence`, the index into GameSet.games it resolved
    // to (identity for fixed; the frozen random subset for random_n_of_pool) —
    // so the exact authored spec (duration/difficulty/…) is recoverable.
    pickedIndices: { type: [Number], default: [] },
    currentIndex: { type: Number, default: 0 },
    compositeScore: { type: Number, default: 0 },
    // Practice-mode flags frozen from the GameSet at start (so the hot answer
    // path never re-reads the set).
    perQuestionTimerSeconds: { type: Number, default: 0 },
    instantFeedback: { type: Boolean, default: false },
    // Opaque per-attempt token — authorizes the lifecycle like the exam engine.
    attemptToken: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    // Capture-only for later analysis; NO malpractice logic this step.
    warningsTriggered: { type: Number, default: 0 },
    isMalpractice: { type: Boolean, default: false },
  },
  { timestamps: true },
);
gameSetAttemptSchema.index({ user: 1, gameSet: 1 });
gameSetAttemptSchema.index({ gameSet: 1, status: 1 });
gameSetAttemptSchema.index({ college: 1, gameSet: 1 });
export type GameSetAttempt = InferSchemaType<typeof gameSetAttemptSchema>;
export const GameSetAttemptModel = model(
  "GameSetAttempt",
  gameSetAttemptSchema,
);

// --- Served item (embedded in a GameAttempt) --------------------------------
const servedItemSchema = new Schema(
  {
    index: { type: Number, required: true },
    difficulty: { type: String, enum: GAME_DIFFICULTY_VALUES, required: true },
    marks: { type: Number, default: 0 },
    // Full instance WITH solution — denormalized, server-only, never projected.
    instance: { type: Schema.Types.Mixed, required: true },
    submission: { type: Schema.Types.Mixed, default: null },
    // INTERACTIVE games only: server-side discovered state, accumulated across
    // probes (position, keys held, walls bumped, moves). Never client-reported.
    probeState: { type: Schema.Types.Mixed, default: null },
    // Server-set per-item deadline (intrinsic timer), or null when the game has
    // no per-item limit. An answer/probe after it records `expired`.
    itemExpiresAt: { type: Date, default: null },
    // Absent until answered; then one of GAME_OUTCOME_VALUES.
    outcome: { type: String, enum: GAME_OUTCOME_VALUES },
    servedAt: { type: Date, default: Date.now },
    answeredAt: { type: Date, default: null },
    // servedAt → answeredAt latency, capture-only (outlier analysis later).
    latencyMs: { type: Number, default: null },
  },
  { _id: false },
);

// --- GameAttempt (child, one per game in the sequence) ----------------------
const gameAttemptSchema = new Schema(
  {
    parent: {
      type: Schema.Types.ObjectId,
      ref: "GameSetAttempt",
      required: true,
    },
    gameIndex: { type: Number, required: true },
    gameKey: { type: String, enum: GAME_KEY_VALUES, required: true },
    seed: { type: String, required: true },
    // Frozen from the authored GameSpec at creation (hot-path answer needs them).
    allowSkip: { type: Boolean, default: true },
    maxQuestions: { type: Number, default: 0 },
    // Effective per-item seconds (module default, possibly overridden by the
    // GameSet practice flag), frozen at creation. null = no per-item limit.
    itemSeconds: { type: Number, default: null },
    // Frozen per-game authoring config passed to an interactive module's probe
    // (e.g. door_key's { onWallHit }). Opaque to the engine.
    config: { type: Schema.Types.Mixed, default: () => ({}) },
    // { difficulty } — the adaptive ladder state (shared reducer drives it).
    ladder: {
      type: Schema.Types.Mixed,
      default: () => ({ difficulty: GameDifficulty.EASY }),
    },
    served: { type: [servedItemSchema], default: [] },
    score: { type: Number, default: 0 },
    questionsServed: { type: Number, default: 0 },
    questionsAttempted: { type: Number, default: 0 },
    questionsCorrect: { type: Number, default: 0 },
    // Server-authoritative clock end (start + durationSeconds). Client-never-set.
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: GAME_ATTEMPT_STATUS_VALUES,
      default: GameAttemptStatus.IN_PROGRESS,
    },
  },
  { timestamps: true },
);
gameAttemptSchema.index({ parent: 1, gameIndex: 1 });
export type GameAttempt = InferSchemaType<typeof gameAttemptSchema>;
export const GameAttemptModel = model("GameAttempt", gameAttemptSchema);

// --- GameSetAttemptCounter (per-user attempt limit enforcement) -------------
// Mirrors ExamAttemptCounter: an atomic upsert-counter per (user, gameSet) so a
// concurrent double-start can't both pass the maxAttempts check.
const gameSetAttemptCounterSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    gameSet: { type: Schema.Types.ObjectId, ref: "GameSet", required: true },
    attemptCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
gameSetAttemptCounterSchema.index({ user: 1, gameSet: 1 }, { unique: true });
export type GameSetAttemptCounter = InferSchemaType<
  typeof gameSetAttemptCounterSchema
>;
export const GameSetAttemptCounterModel = model(
  "GameSetAttemptCounter",
  gameSetAttemptCounterSchema,
);
