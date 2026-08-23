/**
 * Pure logic behind the GameSetEditor (Step 8): the registry-driven picker
 * (devOnly filtered), per-game default resolution, per-game option
 * applicability, and the publish-validity mirror. Visual layer not covered.
 */
import { GameKey } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  defaultGameSpec,
  gameOptionApplicability,
  gamePickerOptions,
  publishBlockReason,
} from "../src/lib/game-editor.js";

describe("registry-driven picker", () => {
  it("offers every real game and NEVER the devOnly _probe", () => {
    const keys = gamePickerOptions().map((o) => o.key);
    expect(keys).not.toContain(GameKey.PROBE); // devOnly filtered
    for (const k of [
      GameKey.GEO_SUDO,
      GameKey.SWITCH_CHALLENGE,
      GameKey.MOTION_CHALLENGE,
      GameKey.INDUCTIVE_REASONING,
      GameKey.BUBBLE_MATH,
      GameKey.DOOR_KEY,
    ]) {
      expect(keys).toContain(k);
    }
    // door_key is flagged interactive so the picker/editor can adapt.
    expect(
      gamePickerOptions().find((o) => o.key === GameKey.DOOR_KEY)?.interactive,
    ).toBe(true);
  });
});

describe("per-game default resolution (from the module)", () => {
  it("seeds a spec with the module's own defaults", () => {
    const door = defaultGameSpec(GameKey.DOOR_KEY);
    expect(door.gameKey).toBe(GameKey.DOOR_KEY);
    expect(door.durationSeconds).toBe(360); // door_key defaultClockSeconds
    expect(door.allowSkip).toBe(true); // door_key allowSkipDefault
    // switch_challenge forbids skipping — its default reflects that.
    expect(defaultGameSpec(GameKey.SWITCH_CHALLENGE).allowSkip).toBe(false);
  });
});

describe("per-game option applicability", () => {
  it("onWallHit only for interactive (door_key); skip only where the module allows it", () => {
    expect(gameOptionApplicability(GameKey.DOOR_KEY)).toEqual({
      onWallHit: true,
      allowSkip: true,
    });
    expect(gameOptionApplicability(GameKey.GEO_SUDO).onWallHit).toBe(false);
    // switch_challenge: skip is server-forbidden → the editor hides the toggle.
    expect(gameOptionApplicability(GameKey.SWITCH_CHALLENGE).allowSkip).toBe(false);
  });
});

describe("publish-validity mirror", () => {
  it("blocks an empty set", () => {
    expect(publishBlockReason({ games: [], selectionMode: "fixed" })).toMatch(/at least one/i);
  });
  it("blocks random_n_of_pool when pickCount exceeds the pool", () => {
    expect(
      publishBlockReason({ games: [1, 2], selectionMode: "random_n_of_pool", pickCount: 5 }),
    ).toMatch(/exceeds/i);
  });
  it("blocks random_n_of_pool with no/zero pickCount", () => {
    expect(
      publishBlockReason({ games: [1, 2], selectionMode: "random_n_of_pool", pickCount: 0 }),
    ).toMatch(/how many/i);
  });
  it("passes a valid fixed set and a valid random set", () => {
    expect(publishBlockReason({ games: [1], selectionMode: "fixed" })).toBeNull();
    expect(
      publishBlockReason({ games: [1, 2, 3], selectionMode: "random_n_of_pool", pickCount: 2 }),
    ).toBeNull();
  });
});
