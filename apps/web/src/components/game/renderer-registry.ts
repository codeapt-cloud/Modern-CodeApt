/**
 * GameKey → renderer registry, mirroring the server's GAME_REGISTRY. The shell
 * stays game-agnostic: it looks a renderer up by the item's gameKey and hands it
 * the GamePrompt contract props. A 7b/7c author adds ONE component + ONE entry
 * here and the shell renders it with zero further changes.
 *
 * `Partial` because 7a ships only the `_probe` renderer; the five one-shot
 * renderers (7b) and door_key (7c) fill the rest. A missing renderer surfaces a
 * calm fallback in the shell rather than crashing.
 */
import { GameKey } from "@codeapt/shared";

import type { GameRenderer } from "./renderer-contract.js";
import { BubbleMathRenderer } from "./renderers/BubbleMathRenderer.js";
import { DoorKeyRenderer } from "./renderers/DoorKeyRenderer.js";
import { GeoSudoRenderer } from "./renderers/GeoSudoRenderer.js";
import { GridChallengeRenderer } from "./renderers/GridChallengeRenderer.js";
import { InductiveRenderer } from "./renderers/InductiveRenderer.js";
import { MotionRenderer } from "./renderers/MotionRenderer.js";
import { ProbeRenderer } from "./renderers/ProbeRenderer.js";
import { SwitchRenderer } from "./renderers/SwitchRenderer.js";

export const GAME_RENDERERS: Partial<Record<GameKey, GameRenderer>> = {
  [GameKey.PROBE]: ProbeRenderer,
  [GameKey.GEO_SUDO]: GeoSudoRenderer,
  [GameKey.SWITCH_CHALLENGE]: SwitchRenderer,
  [GameKey.MOTION_CHALLENGE]: MotionRenderer,
  [GameKey.INDUCTIVE_REASONING]: InductiveRenderer,
  [GameKey.BUBBLE_MATH]: BubbleMathRenderer,
  // door_key is INTERACTIVE — it drives the `probe` channel, not onSubmit.
  [GameKey.DOOR_KEY]: DoorKeyRenderer,
  // grid_challenge is INTERACTIVE too — a phased dual task over the probe channel.
  [GameKey.GRID_CHALLENGE]: GridChallengeRenderer,
};

export function getGameRenderer(key: GameKey): GameRenderer | undefined {
  return GAME_RENDERERS[key];
}
