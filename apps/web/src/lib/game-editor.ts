/**
 * Pure helpers for the GameSetEditor — the registry-driven picker, per-game
 * default resolution, per-game option applicability, and the publish-validity
 * mirror. No React; unit-tested. Adding a seventh game to GAME_REGISTRY makes it
 * appear here (and in the picker) with no change to this file or the editor.
 */
import {
  GAME_CATALOG,
  GameSelectionMode,
  type GameKey,
  type GameSpecInput,
} from "@codeapt/shared";

export interface GamePickerOption {
  key: GameKey;
  name: string;
  interactive: boolean;
}

/** Pickable games: registry-driven, `devOnly` filtered so `_probe` never shows. */
export function gamePickerOptions(): GamePickerOption[] {
  return GAME_CATALOG.filter((g) => !g.devOnly).map((g) => ({
    key: g.key,
    name: g.displayName,
    interactive: g.interactive,
  }));
}

/** A fresh spec seeded with the MODULE's own defaults for the chosen game. */
export function defaultGameSpec(key: GameKey): Required<GameSpecInput> {
  const cat = GAME_CATALOG.find((g) => g.key === key);
  return {
    gameKey: key,
    durationSeconds: cat?.defaultClockSeconds ?? 360,
    allowSkip: cat?.allowSkipDefault ?? true,
    startingDifficulty: "easy",
    maxQuestions: 0,
    onWallHit: "block",
  };
}

/** Which per-game controls are MEANINGFUL for a key, so the editor never offers
 * a control that does nothing: `onWallHit` only for interactive games
 * (door_key); the skip toggle only when the module permits skipping (it's
 * server-forbidden for switch_challenge, whose allowSkipDefault is false). */
export function gameOptionApplicability(key: GameKey): {
  onWallHit: boolean;
  allowSkip: boolean;
} {
  const cat = GAME_CATALOG.find((g) => g.key === key);
  return {
    onWallHit: cat?.interactive ?? false,
    allowSkip: cat?.allowSkipDefault ?? true,
  };
}

/** Mirror of the SERVICE publish guard, for a disabled Publish button + a
 * reason. The service is the real guard; this only pre-warns the operator. */
export function publishBlockReason(draft: {
  games: readonly unknown[];
  selectionMode: string;
  pickCount?: number | null;
}): string | null {
  if (draft.games.length === 0) return "Add at least one game.";
  if (draft.selectionMode === GameSelectionMode.RANDOM_N_OF_POOL) {
    const pc = draft.pickCount ?? 0;
    if (pc < 1) return "Set how many games to pick for random selection.";
    if (pc > draft.games.length) {
      return "Pick count exceeds the number of games in the pool.";
    }
  }
  return null;
}
