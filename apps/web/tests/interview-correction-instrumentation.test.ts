/**
 * Step 36 E — INSTRUMENTED correction pass. For a set of realistic mishearings,
 * classify each as caught by the deterministic TERM LIST, caught by the LLM pass
 * (simulated here as the model proposing the ground-truth fix, then run through
 * the real structural guard `acceptContextCorrection`), or a MISS. The dump is the
 * pass/miss table the DoD asks for. It also proves the fix: a short answer with
 * several small homophone fixes (edit ratio ~0.5) is now ACCEPTED — the old blunt
 * 0.3 cap rejected exactly these, which was the cause of "works sometimes".
 */
import {
  acceptContextCorrection,
  correctTranscript,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

type Stage = "termlist" | "llm" | "miss";

/** Run the two-stage pipeline the server runs, and report which stage fixed it.
 *  The LLM is simulated by proposing the ground-truth `expected`; the REAL guard
 *  then decides whether to trust it (so this measures the guard, not a model). */
function classify(raw: string, expected: string, terms: string[]): Stage {
  const termCorrected = correctTranscript(raw, terms).corrected.trim();
  if (termCorrected === expected) return "termlist";
  const r = acceptContextCorrection(termCorrected, expected);
  return r.accepted && r.text.trim() === expected ? "llm" : "miss";
}

const CASES: { raw: string; expected: string; terms: string[]; note: string }[] = [
  { raw: "i worked on the front end", expected: "i worked on the frontend", terms: ["frontend"], note: "JD term, spacing" },
  { raw: "deployed on kubernetis", expected: "deployed on Kubernetes", terms: ["Kubernetes"], note: "JD term, near-miss" },
  { raw: "built with node js", expected: "built with Node.js", terms: ["Node.js"], note: "JD term, split" },
  { raw: "we exposed a sql endpoint", expected: "we exposed a SQL endpoint", terms: ["SQL"], note: "JD term, casing" },
  { raw: "we used to sing the data nightly", expected: "we used to sync the data nightly", terms: [], note: "general homophone, no term" },
  { raw: "we sink the daytah", expected: "we sync the data", terms: [], note: "SHORT answer, 2 fixes (ratio .5)" },
  { raw: "our micro services talk over rest", expected: "our microservices talk over REST", terms: ["REST"], note: "merge + casing" },
  { raw: "we used cuber for orchestration", expected: "we used Kubernetes for orchestration", terms: ["Kubernetes"], note: "heavily garbled term (expected MISS)" },
];

describe("correction pass — instrumented pass/miss table", () => {
  it("catches realistic mishearings across term-list + LLM, with an honest miss", () => {
    const rows = CASES.map((c) => ({ ...c, stage: classify(c.raw, c.expected, c.terms) }));
    const table = rows
      .map((r) => `${r.stage.toUpperCase().padEnd(8)} | ${r.note.padEnd(34)} | "${r.raw}" → "${r.expected}"`)
      .join("\n");
    console.log("\n--- CORRECTION PASS/MISS TABLE ---\n" + table + "\n");

    const count = (s: Stage) => rows.filter((r) => r.stage === s).length;
    expect(count("termlist")).toBeGreaterThanOrEqual(4);
    expect(count("llm")).toBeGreaterThanOrEqual(2);
    // At most one miss — the heavily-garbled term the term list lacks and whose
    // single-word swap is too large for the guard to trust (a safe rejection).
    expect(count("miss")).toBeLessThanOrEqual(1);

    // The short-answer, multi-fix case is CAUGHT now (the Step-35 0.3 cap missed it).
    const short = rows.find((r) => r.raw === "we sink the daytah")!;
    expect(short.stage).toBe("llm");
  });

  it("still REFUSES a rewrite (the guard is not merely loosened)", () => {
    const input = "i built the api and it worked";
    const rewrite = "I engineered a highly scalable REST API that performed flawlessly under load";
    expect(acceptContextCorrection(input, rewrite).accepted).toBe(false);
    // A single-word swap to a dissimilar word is also refused (content change).
    expect(acceptContextCorrection("we shipped the feature", "we cancelled the feature").accepted).toBe(
      false,
    );
  });
});
