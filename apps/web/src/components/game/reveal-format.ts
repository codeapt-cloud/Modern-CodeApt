/**
 * Practice-mode reveal formatter (Step 26 G6). Turns a module's STRUCTURED
 * `explain` solution into the human text a student reads, per game — replacing
 * the old `JSON.stringify(solution)` debug dump. This is deliberately a CLIENT
 * presentation concern: `explain` keeps returning its structured solution (which
 * the operator/result surfaces can still use), and rendering lives here beside
 * the renderer registry, preserving the seam's "one line per game" property.
 *
 * Any game without a formatter falls back to the human `note` alone — NEVER to a
 * raw object.
 */
const LETTERS = ["A", "B", "C", "D", "E", "F"];

function isMoves(s: unknown): s is { optimalMoves: number } {
  return (
    typeof s === "object" &&
    s !== null &&
    typeof (s as { optimalMoves?: unknown }).optimalMoves === "number"
  );
}
function isInductive(s: unknown): s is { indices: number[]; rule: string } {
  return (
    typeof s === "object" &&
    s !== null &&
    Array.isArray((s as { indices?: unknown }).indices) &&
    typeof (s as { rule?: unknown }).rule === "string"
  );
}
function isGrid(
  s: unknown,
): s is { recallOrder: number[]; rotations: boolean[] } {
  return (
    typeof s === "object" &&
    s !== null &&
    Array.isArray((s as { recallOrder?: unknown }).recallOrder) &&
    Array.isArray((s as { rotations?: unknown }).rotations)
  );
}

export function formatReveal(
  gameKey: string,
  solution: unknown,
  note?: string,
): string {
  const n = note ? note.trim() : "";
  const withNote = (s: string): string => (n ? `${s} ${n}` : s);

  switch (gameKey) {
    case "geo_sudo":
      // solution is the missing symbol; name it (the note explains the deduction).
      return typeof solution === "string"
        ? withNote(`The ? cell is ${solution}.`)
        : n;

    case "switch_challenge":
      // solution is the answer arrangement (indices) — render as a slot mapping,
      // never the bare [2,0,3,1].
      return Array.isArray(solution)
        ? withNote(
            `Answer: ${solution
              .map((v, i) => `slot ${i + 1} → ${Number(v) + 1}`)
              .join(", ")}.`,
          )
        : n;

    case "motion_challenge":
    case "door_key":
      // The note already states optimal-vs-your move count; the path object is
      // internal. Prefer the note; synthesise a count line only if it's missing.
      return n || (isMoves(solution) ? `Optimal: ${solution.optimalMoves} moves.` : "");

    case "inductive_reasoning":
      // Name the rule family and which two options conformed (A–D).
      return isInductive(solution)
        ? `The rule is “${solution.rule}”. Options ${solution.indices
            .map((i) => LETTERS[i] ?? String(i + 1))
            .join(" and ")} follow it.`
        : n;

    case "bubble_math":
      // The note lists the three values in ascending order; fall back to indices.
      return (
        n ||
        (Array.isArray(solution)
          ? `Ascending order: bubbles ${solution.map((i) => Number(i) + 1).join(" < ")}.`
          : "")
      );

    case "grid_challenge":
      return isGrid(solution)
        ? `Recall order: circles ${solution.recallOrder
            .map((i) => i + 1)
            .join(", ")}. Each rotation pair was: ${solution.rotations
            .map((b) => (b ? "same" : "different"))
            .join(", ")}.`
        : n;

    case "_probe":
      // Dev-only — the simplest readable thing.
      return Array.isArray(solution) ? `Answer: ${solution.join(", ")}` : n;

    default:
      // No formatter → the human note alone, never a raw object.
      return n;
  }
}
