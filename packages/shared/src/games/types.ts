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
 * A fully-typed game module, generic over its submission `Schema`. `Instance`
 * holds the solution; `ClientView` must not (enforced by `& NoSolution`);
 * `z.infer<Schema>` is the player's replayed move payload. Real games implement
 * this with concrete types; the registry erases them to `AnyGameModule`.
 */
export interface GameModule<
  Instance,
  ClientView,
  Schema extends z.ZodType,
> {
  readonly key: GameKey;
  readonly displayName: string;
  /** Whether skip is offered by default (per-game config can still restrict). */
  readonly allowSkipDefault: boolean;
  /** Default game-clock seconds when a GameSpec doesn't set one. */
  readonly defaultClockSeconds: number;
  /** Dev-only games are never offered in an admin picker. */
  readonly devOnly: boolean;
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
   * PRACTICE-mode reveal (post-answer only, gated by the service). MAY reveal
   * the solution. `submission` is the stored move (null for skip/expired).
   */
  explain(
    instance: Instance,
    submission: z.infer<Schema> | null,
  ): GameExplanation;
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
  readonly devOnly: boolean;
  readonly submissionSchema: z.ZodType<unknown>;
  generate(seed: string, difficulty: GameDifficulty): unknown;
  toClientView(instance: unknown): unknown;
  score(instance: unknown, submission: unknown): GameScoreResult;
  explain(instance: unknown, submission: unknown): GameExplanation;
}
