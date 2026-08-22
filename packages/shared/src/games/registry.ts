/**
 * The game registry: one uniform `Record<GameKey, AnyGameModule>` the service
 * indexes by the persisted `gameKey`. Concrete modules are strongly typed
 * (`GameModule<I, V, S>`); `eraseGame` wraps one into the type-erased
 * `AnyGameModule` boundary so the service can hold them uniformly and pass
 * around `unknown` instances it only ever persists and hands back to the SAME
 * module. This is the ONE place casts live, and they are sound: the instance
 * fed to `toClientView`/`score` is exactly what this module's `generate`
 * produced (round-tripped through the DB), and the submission is validated at
 * the zod/service boundary before it arrives here.
 */
import type { z } from "zod";

import { GameKey } from "../enums.js";
import { geoSudoModule } from "./geo-sudo.js";
import { inductiveReasoningModule } from "./inductive-reasoning.js";
import { motionChallengeModule } from "./motion-challenge.js";
import { probeModule } from "./probe.js";
import { switchChallengeModule } from "./switch-challenge.js";
import type { AnyGameModule, GameModule } from "./types.js";

function eraseGame<I, V, S extends z.ZodType>(
  m: GameModule<I, V, S>,
): AnyGameModule {
  return {
    key: m.key,
    displayName: m.displayName,
    allowSkipDefault: m.allowSkipDefault,
    defaultClockSeconds: m.defaultClockSeconds,
    devOnly: m.devOnly,
    submissionSchema: m.submissionSchema,
    generate: (seed, difficulty) => m.generate(seed, difficulty),
    toClientView: (instance) => m.toClientView(instance as I),
    // Casts are sound: the instance round-trips from this module's generate, and
    // the submission is validated by submissionSchema before it reaches here.
    score: (instance, submission) =>
      m.score(instance as I, submission as z.infer<S>),
    explain: (instance, submission) =>
      m.explain(instance as I, submission as z.infer<S>),
  };
}

export const GAME_REGISTRY: Record<GameKey, AnyGameModule> = {
  [GameKey.PROBE]: eraseGame(probeModule),
  [GameKey.GEO_SUDO]: eraseGame(geoSudoModule),
  [GameKey.SWITCH_CHALLENGE]: eraseGame(switchChallengeModule),
  [GameKey.MOTION_CHALLENGE]: eraseGame(motionChallengeModule),
  [GameKey.INDUCTIVE_REASONING]: eraseGame(inductiveReasoningModule),
};

/** Look up a module by key, or undefined if the key isn't registered. */
export function getGameModule(key: GameKey): AnyGameModule | undefined {
  return GAME_REGISTRY[key];
}
