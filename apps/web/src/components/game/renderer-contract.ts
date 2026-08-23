/**
 * The GamePrompt render contract — the seam between the game SHELL and a per-
 * game renderer, mirroring the server's GAME_REGISTRY (GameKey → renderer). The
 * shell owns the item lifecycle, both clocks, the answer/probe calls, and all
 * score/ladder chrome; a renderer owns ONLY the puzzle: render the `view`, hold
 * local in-progress selection, and report a submission when the player commits.
 *
 * One props shape serves all six games and never changes:
 *  - ONE-SHOT games ({symbol}/{order}/{moves}/{selected}) draw their own commit
 *    affordance and call `onSubmit(submission)` once. `probe` is undefined.
 *  - The INTERACTIVE game (door_key, 7c) receives a `probe` channel instead: it
 *    drives move-by-move (await probe(action) → redacted next view) and NEVER
 *    calls onSubmit. The shell supplies `probe` iff the item is interactive, so
 *    7c slots in with a new renderer + one registry line — no contract change.
 */
import type { GameDifficulty, GameKey } from "@codeapt/shared";
import type { ComponentType } from "react";

/** The shell-normalized result of one interactive probe move (7c). */
export interface GameProbeResult {
  /** The redacted next view (discovered state only). */
  readonly view: unknown;
  readonly movesUsed: number;
  /** True once the item resolved (goal reached / move cap / expiry). */
  readonly resolved: boolean;
  /** The final outcome when resolved, else null. */
  readonly outcome: string | null;
}

/** Interactive channel — one move in, the redacted next view out (7c only). */
export type GameProbeChannel = (action: unknown) => Promise<GameProbeResult>;

export interface GameRendererProps {
  readonly gameKey: GameKey;
  /** The item's client view (per-game shape; `unknown` at the boundary — the
   * renderer casts it to its own typed ClientView). Never carries a solution. */
  readonly view: unknown;
  /** The current item's ladder rung — a renderer may surface it, or ignore it. */
  readonly difficulty: GameDifficulty;
  /** True once the item is over (answered or expired). The renderer must stop
   * accepting input and present a calm read-only state. */
  readonly locked: boolean;
  /** ONE-SHOT commit: call exactly once when the player commits their answer.
   * The submission must match the game's server submissionSchema. Ignored (and
   * unused) by an interactive renderer. */
  readonly onSubmit: (submission: unknown) => void;
  /** INTERACTIVE channel — present ONLY for interactive items (door_key). A
   * one-shot renderer never receives it. */
  readonly probe?: GameProbeChannel;
}

export type GameRenderer = ComponentType<GameRendererProps>;
