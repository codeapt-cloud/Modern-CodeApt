/**
 * The shared game seam. Every game is a PURE module: `generate(seed, difficulty)`
 * builds the full instance (WITH its solution); `toClientView(instance)` projects
 * away everything answer-revealing; `score(instance, submission)` REPLAYS the
 * player's submission against the stored instance and returns correctness only
 * (the adaptive ladder, not the game, decides marks). No I/O — server and client
 * can both run generate() from the same seed and get the same instance.
 *
 * Anti-leak, structurally (not by convention): a client view type must carry
 * NO `solution`. `toClientView` returns `ClientView & NoSolution`, and
 * `NoSolution` pins `solution?: never` — so if a ClientView ever declared a
 * `solution`, its type collapses to `never` and the projection cannot compile.
 * The full instance never leaves the server; only the client view is served.
 *
 * Submission/schema tie (contract-level, not convention): the module is generic
 * over its zod `Schema`, and `score`/`explain` take `z.infer<Schema>`. So a
 * schema change that no longer matches what `score` reads is a COMPILE error —
 * the scored type IS the schema's inferred type, there is no second declaration
 * to drift from.
 */
import type { z } from "zod";

import type { GameDifficulty, GameKey } from "../enums.js";

/**
 * A structural guarantee that a value cannot carry a solution. Intersecting a
 * client-view type with this makes any `solution` property `never`, so leaking
 * one is a COMPILE error, not a runtime hope.
 */
export interface NoSolution {
  readonly solution?: never;
}

/** What `score` returns — correctness only. Marks come from the ladder, and the
 * client NEVER supplies a score (the server computes it). */
export interface GameScoreResult {
  readonly correct: boolean;
}

/**
 * The post-answer reveal for PRACTICE mode. Unlike the client view, this MAY
 * carry the solution — it flows only through the distinct, gated `explain` path
 * (instantFeedback on AND the item already answered), never on the answer
 * response. `solution` is the game's real answer; `note` is a short human hint.
 */
export interface GameExplanation {
  readonly solution: unknown;
  readonly note?: string;
}

/**
 * INTERACTIVE (hidden-information) sub-contract. One-shot games serve a
 * fully-visible item and score a single submitted move; a game like `door_key`
 * has HIDDEN state (invisible walls) the player discovers move-by-move, so it
 * cannot be solved locally and submitted in one shot. Such a module sets
 * `interactive: true` and provides this contract; the service drives it via a
 * distinct `probe` endpoint.
 *
 * `State` is the per-item DISCOVERED/accumulated state, persisted server-side on
 * the served entry — the client is NEVER trusted to report its own position.
 * `view(instance, state)` returns a REDACTED projection: only what the player
 * has legitimately discovered (never the full hidden set), the same structural
 * discipline as `NoSolution`. `apply` is a PURE single-move transition.
 */
export interface ProbeContract<Instance, State, Action> {
  /** Validates ONE probe action (a single move). Trivially bounded. */
  readonly actionSchema: z.ZodType<Action>;
  /** Initial per-item state. `config` carries frozen per-GameSpec authoring
   * options (e.g. door_key's `onWallHit`); games that don't need it ignore it. */
  init(instance: Instance, config: Record<string, unknown>): State;
  /** Apply one move; returns the next state. Never mutates its arguments. */
  apply(instance: Instance, state: State, action: Action): State;
  /** Has the goal been reached in this state? (item resolves `correct`). */
  resolved(instance: Instance, state: State): boolean;
  /** REDACTED view — discovered state only, never the hidden solution set. */
  view(instance: Instance, state: State): unknown;
  /** Moves used so far — the service caps this to bound the item. */
  movesUsed(state: State): number;
}

/**
 * A fully-typed game module, generic over its submission `Schema` (and, for
 * interactive games, its probe `ProbeState`/`ProbeAction`). `Instance` holds the
 * solution; `ClientView` must not (enforced by `& NoSolution`); `z.infer<Schema>`
 * is the player's replayed move payload. Real games implement this with concrete
 * types; the registry erases them to `AnyGameModule`.
 */
export interface GameModule<
  Instance,
  ClientView,
  Schema extends z.ZodType,
  ProbeState = never,
  ProbeAction = never,
> {
  readonly key: GameKey;
  readonly displayName: string;
  /** Whether skip is offered by default (per-game config can still restrict). */
  readonly allowSkipDefault: boolean;
  /** Default game-clock seconds when a GameSpec doesn't set one. */
  readonly defaultClockSeconds: number;
  /**
   * INTRINSIC per-item time limit in seconds, or null for none. Unlike the
   * GameSet's practice-mode `perQuestionTimerSeconds` flag, this is a property of
   * the GAME (Bubble is ~15s/question by design). The service enforces it
   * server-side — an answer after the item deadline records `expired`, 0 marks,
   * exactly like the game clock. A GameSet practice override may CHANGE it but
   * setting the override to 0 falls back to this default (it cannot REMOVE an
   * intrinsic limit). For an interactive item the limit bounds the WHOLE
   * exploration (all probes), not each probe.
   */
  readonly defaultItemSeconds: number | null;
  /** Dev-only games are never offered in an admin picker. */
  readonly devOnly: boolean;
  /** Interactive (hidden-information) games set this true and provide `probe`.
   * One-shot games leave it false; the answer path is unchanged for them. */
  readonly interactive: boolean;
  /** Present iff `interactive` — the move-by-move probe contract. */
  readonly probe?: ProbeContract<Instance, ProbeState, ProbeAction>;
  /**
   * Validates the raw submission BEFORE replay. The service parses against this
   * first; a parse failure scores the answer `wrong` (never a 500). EVERY array
   * in here MUST be `.max(...)`-bounded — an unbounded array is a memory vector
   * on the hot answer path.
   */
  readonly submissionSchema: Schema;
  generate(seed: string, difficulty: GameDifficulty): Instance;
  toClientView(instance: Instance): ClientView & NoSolution;
  score(instance: Instance, submission: z.infer<Schema>): GameScoreResult;
  /**
   * OPTIONAL custom scoring for an INTERACTIVE game whose marks are NOT the
   * ladder's tier value — e.g. grid_challenge's +3/-1-per-answer, which can total
   * NEGATIVE. When a module provides `settle`, the service uses these marks (not
   * `applyLadderOutcome`'s) for a RESOLVED item; `correct` drives difficulty
   * movement + analytics. Omitted by every other game → the ladder is unchanged
   * and no game but this one can score below zero. Called only on resolution, so
   * `state` is the final accumulated probe state.
   */
  settle?(instance: Instance, state: ProbeState): GameScoreResult & {
    readonly marks: number;
  };
  /**
   * PRACTICE-mode reveal (post-answer only, gated by the service). MAY reveal
   * the solution. `submission` is the stored move (null for skip/expired).
   */
  explain(
    instance: Instance,
    submission: z.infer<Schema> | null,
  ): GameExplanation;
}

/** Type-erased probe contract (registry boundary). */
export interface AnyProbeContract {
  readonly actionSchema: z.ZodType<unknown>;
  init(instance: unknown, config: Record<string, unknown>): unknown;
  apply(instance: unknown, state: unknown, action: unknown): unknown;
  resolved(instance: unknown, state: unknown): boolean;
  view(instance: unknown, state: unknown): unknown;
  movesUsed(state: unknown): number;
}

/**
 * The registry-facing, type-erased module. Each concrete `GameModule<I,V,S>` is
 * wrapped by `eraseGame` (registry.ts) so the service can hold a uniform
 * `Record<GameKey, AnyGameModule>` and pass around `unknown` instances it only
 * ever persists + hands back to the SAME module. The one place casts live.
 */
export interface AnyGameModule {
  readonly key: GameKey;
  readonly displayName: string;
  readonly allowSkipDefault: boolean;
  readonly defaultClockSeconds: number;
  readonly defaultItemSeconds: number | null;
  readonly devOnly: boolean;
  readonly interactive: boolean;
  readonly probe?: AnyProbeContract;
  readonly submissionSchema: z.ZodType<unknown>;
  generate(seed: string, difficulty: GameDifficulty): unknown;
  toClientView(instance: unknown): unknown;
  score(instance: unknown, submission: unknown): GameScoreResult;
  /** Present iff the concrete module declares custom scoring (grid_challenge). */
  settle?(instance: unknown, state: unknown): GameScoreResult & { readonly marks: number };
  explain(instance: unknown, submission: unknown): GameExplanation;
}
