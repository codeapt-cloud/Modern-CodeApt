/**
 * Step 26 G6 — the practice-mode reveal renders HUMAN text per game, never the
 * old JSON.stringify(solution) debug dump. These assert the exact string a
 * student reads for each non-dev game, and that no object solution leaks as raw
 * JSON (no "{" / "[" from a stringified object/array).
 */
import { describe, expect, it } from "vitest";

import { formatReveal } from "../src/components/game/reveal-format.js";

describe("formatReveal — human reveal text per game (G6)", () => {
  it("geo_sudo names the symbol", () => {
    const s = formatReveal("geo_sudo", "▲", "Only symbol absent from the ? row/col.");
    expect(s).toBe("The ? cell is ▲. Only symbol absent from the ? row/col.");
  });

  it("switch_challenge renders a slot mapping, not a raw array", () => {
    const s = formatReveal("switch_challenge", [2, 0, 3, 1], "Answer is the output arrangement.");
    expect(s).toBe(
      "Answer: slot 1 → 3, slot 2 → 1, slot 3 → 4, slot 4 → 2. Answer is the output arrangement.",
    );
    expect(s).not.toContain("[");
  });

  it("motion_challenge / door_key show the move count via the note, no path object", () => {
    const motion = formatReveal(
      "motion_challenge",
      { optimalMoves: 4, optimalPath: [{ x: 0 }, { x: 1 }] },
      "Optimal is 4 moves; you played 6.",
    );
    expect(motion).toBe("Optimal is 4 moves; you played 6.");
    expect(motion).not.toContain("{");
    const door = formatReveal("door_key", { optimalMoves: 7, optimalPath: [], walls: [] }, "");
    expect(door).toBe("Optimal: 7 moves.");
  });

  it("inductive_reasoning names the rule family and the two conforming options", () => {
    const s = formatReveal(
      "inductive_reasoning",
      { indices: [0, 2], rule: "rotate90" },
      "The two grids follow the rotate90 rule.",
    );
    expect(s).toBe("The rule is “rotate90”. Options A and C follow it.");
  });

  it("bubble_math shows the ascending values (via the note)", () => {
    const s = formatReveal("bubble_math", [1, 0, 2], "Ascending: 2+2=4 < 3×3=9 < 5×4=20.");
    expect(s).toBe("Ascending: 2+2=4 < 3×3=9 < 5×4=20.");
  });

  it("grid_challenge spells out the recall order and per-cycle rotations", () => {
    const s = formatReveal(
      "grid_challenge",
      { recallOrder: [3, 17, 8], rotations: [true, false, true] },
      "note ignored for grid",
    );
    expect(s).toBe(
      "Recall order: circles 4, 18, 9. Each rotation pair was: same, different, same.",
    );
    expect(s).not.toContain("{");
    expect(s).not.toContain("recallOrder");
  });

  it("falls back to the note (never JSON) for an unknown game or odd solution", () => {
    expect(formatReveal("mystery_game", { a: 1 }, "just the note")).toBe("just the note");
    expect(formatReveal("geo_sudo", { weird: true }, "fallback")).toBe("fallback");
    // No note + unformattable → empty, not "[object Object]" or JSON.
    expect(formatReveal("mystery_game", { a: 1 })).toBe("");
  });

  it("never emits JSON for any real game's object solution", () => {
    const objSolutions: Array<[string, unknown]> = [
      ["motion_challenge", { optimalMoves: 3, optimalPath: [] }],
      ["door_key", { optimalMoves: 3, optimalPath: [], walls: [] }],
      ["inductive_reasoning", { indices: [1, 3], rule: "reflect" }],
      ["grid_challenge", { recallOrder: [1], rotations: [false] }],
    ];
    for (const [key, sol] of objSolutions) {
      const s = formatReveal(key, sol, "note");
      expect(s.includes("{") || s.includes('":')).toBe(false);
    }
  });
});
