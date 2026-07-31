/**
 * Automatic daily-challenge generator pipeline (pure decision logic, in-memory
 * fakes for the store / LLM / Piston — no Mongo, no network). Proves the DoD:
 * valid AI → published `ai`; a FAILING reference solution → rejected → bank
 * fallback; malformed LLM → fallback; date exists → no-op (idempotent); bank
 * picks an UNUSED question; provenance recorded; bank empty → curated fallback;
 * force replaces an existing challenge.
 */
import {
  CodeLanguage,
  DailyChallengeSource,
  DailyQuestionType,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  runDailyChallengePipeline,
  type BankCandidate,
  type DailyChallengeStore,
  type GeneratorDeps,
  type Provenance,
  type PublishSpec,
} from "../src/lib/daily-challenge/generator.js";

const DAY = "2026-08-01";
const NOW = new Date("2026-08-01T00:01:00.000Z");

interface Recorded {
  created: { releaseDate: Date; spec: PublishSpec; prov: Provenance }[];
  removed: string[];
}

function makeStore(opts: {
  existingId?: string | null;
  bank?: BankCandidate[];
  usage?: Map<string, Date>;
}): { store: DailyChallengeStore; rec: Recorded } {
  const rec: Recorded = { created: [], removed: [] };
  const store: DailyChallengeStore = {
    findByReleaseDate: async () =>
      opts.existingId ? { id: opts.existingId } : null,
    remove: async (id) => {
      rec.removed.push(id);
    },
    create: async (releaseDate, spec, prov) => {
      rec.created.push({ releaseDate, spec, prov });
    },
    bankCandidates: async () => opts.bank ?? [],
    bankUsage: async () => opts.usage ?? new Map(),
  };
  return { store, rec };
}

/** A schema-valid AI CODE challenge whose reference solution echoes stdin. */
const VALID_AI = {
  questionType: "CODE",
  title: "Echo the line",
  statement: "Read one line and print it back unchanged.",
  starterCode: "s = input()\n",
  language: "python",
  referenceSolution: "print(input())",
  difficulty: "easy",
  testCases: [
    { input: "alpha", expectedOutput: "alpha", isHidden: false },
    { input: "beta", expectedOutput: "beta", isHidden: false },
    { input: "gamma", expectedOutput: "gamma", isHidden: true },
  ],
};

/** A schema-valid AI MCQ challenge (no execution needed). */
const VALID_AI_MCQ = {
  questionType: "MCQ",
  title: "Constant-time lookup",
  statement: "Which operation is O(1) on average?",
  difficulty: "easy",
  options: ["Array index", "Linear search", "Bubble sort"],
  correctOption: 0,
};

/** Piston fake that echoes stdin (so VALID_AI's cases all pass). */
const echoPiston: GeneratorDeps["piston"] = async (_lang, _src, stdin) => stdin;
/** Piston fake that always returns the wrong output (reference "fails"). */
const wrongPiston: GeneratorDeps["piston"] = async () => "WRONG";

function bankCandidate(id: string): BankCandidate {
  return {
    id,
    spec: {
      questionType: DailyQuestionType.CODE,
      title: `Bank ${id}`,
      description: "A curated bank problem.",
      starterCode: "",
      language: CodeLanguage.PYTHON,
      marks: 5,
      testCases: [{ input: "1", expectedOutput: "1", isHidden: false }],
    },
  };
}

function deps(
  store: DailyChallengeStore,
  llm: GeneratorDeps["llm"],
  piston: GeneratorDeps["piston"],
): GeneratorDeps {
  return { store, llm, piston, now: () => NOW };
}

describe("daily-challenge generator pipeline", () => {
  it("publishes a valid AI challenge (reference solution passes) as source 'ai'", async () => {
    const { store, rec } = makeStore({});
    const outcome = await runDailyChallengePipeline({
      dayKey: DAY,
      deps: deps(store, async () => VALID_AI, echoPiston),
    });
    expect(outcome.status).toBe("ai");
    expect(rec.created).toHaveLength(1);
    const pub = rec.created[0]!;
    expect(pub.prov.source).toBe(DailyChallengeSource.AI);
    expect(pub.prov.generatedAt).toBe(NOW); // provenance timestamp recorded
    expect(pub.prov.validationNote).toContain("passed all 3");
    expect(pub.spec.questionType).toBe(DailyQuestionType.CODE);
    expect(pub.spec.title).toBe("Echo the line");
    expect(pub.spec.testCases).toHaveLength(3);
  });

  it("publishes an AI MCQ challenge (no execution needed) as source 'ai'", async () => {
    const { store, rec } = makeStore({});
    const outcome = await runDailyChallengePipeline({
      dayKey: DAY,
      // Piston must NOT be called for an MCQ — throw if it is.
      deps: deps(store, async () => VALID_AI_MCQ, async () => {
        throw new Error("piston must not run for MCQ");
      }),
    });
    expect(outcome.status).toBe("ai");
    const pub = rec.created[0]!;
    expect(pub.spec.questionType).toBe(DailyQuestionType.MCQ);
    expect(pub.spec.options).toEqual([
      "Array index",
      "Linear search",
      "Bubble sort",
    ]);
    expect(pub.spec.correctOption).toBe(0);
    expect(pub.spec.testCases ?? []).toHaveLength(0);
    expect(pub.prov.source).toBe(DailyChallengeSource.AI);
    expect(pub.prov.validationNote).toContain("MCQ");
  });

  it("rejects an AI challenge whose reference solution FAILS its cases → bank fallback", async () => {
    const { store, rec } = makeStore({ bank: [bankCandidate("b1")] });
    const outcome = await runDailyChallengePipeline({
      dayKey: DAY,
      deps: deps(store, async () => VALID_AI, wrongPiston),
    });
    expect(outcome.status).toBe("bank_fallback");
    expect(rec.created[0]!.prov.source).toBe(
      DailyChallengeSource.BANK_FALLBACK,
    );
    expect(rec.created[0]!.prov.bankQuestionId).toBe("b1");
  });

  it("falls back when the LLM returns malformed JSON", async () => {
    const { store, rec } = makeStore({ bank: [bankCandidate("b9")] });
    const outcome = await runDailyChallengePipeline({
      dayKey: DAY,
      deps: deps(store, async () => ({ nonsense: true }), echoPiston),
    });
    expect(outcome.status).toBe("bank_fallback");
    expect(rec.created[0]!.prov.bankQuestionId).toBe("b9");
  });

  it("falls back when the LLM is unavailable (returns null)", async () => {
    const { store, rec } = makeStore({ bank: [bankCandidate("b2")] });
    const outcome = await runDailyChallengePipeline({
      dayKey: DAY,
      deps: deps(store, async () => null, echoPiston),
    });
    expect(outcome.status).toBe("bank_fallback");
    expect(rec.created).toHaveLength(1);
  });

  it("is idempotent: a day that already exists is a no-op (no create)", async () => {
    const { store, rec } = makeStore({ existingId: "x1" });
    const outcome = await runDailyChallengePipeline({
      dayKey: DAY,
      deps: deps(store, async () => VALID_AI, echoPiston),
    });
    expect(outcome.status).toBe("skip");
    expect(rec.created).toHaveLength(0);
    expect(rec.removed).toHaveLength(0);
  });

  it("force replaces an existing challenge (removes old, then creates)", async () => {
    const { store, rec } = makeStore({ existingId: "old-1" });
    const outcome = await runDailyChallengePipeline({
      dayKey: DAY,
      force: true,
      deps: deps(store, async () => VALID_AI, echoPiston),
    });
    expect(outcome.status).toBe("ai");
    expect(rec.removed).toEqual(["old-1"]);
    expect(rec.created).toHaveLength(1);
  });

  it("bank fallback picks an UNUSED question over a used one", async () => {
    const usage = new Map<string, Date>([
      ["b1", new Date("2026-07-30T00:00:00Z")],
    ]);
    const { store, rec } = makeStore({
      bank: [bankCandidate("b1"), bankCandidate("b2")],
      usage,
    });
    const outcome = await runDailyChallengePipeline({
      dayKey: DAY,
      deps: deps(store, async () => null, echoPiston),
    });
    expect(outcome.status).toBe("bank_fallback");
    expect(rec.created[0]!.prov.bankQuestionId).toBe("b2"); // unused one
  });

  it("reuses the least-recently-used bank question when all are used", async () => {
    const usage = new Map<string, Date>([
      ["b1", new Date("2026-07-20T00:00:00Z")], // older → LRU
      ["b2", new Date("2026-07-29T00:00:00Z")],
    ]);
    const { store, rec } = makeStore({
      bank: [bankCandidate("b1"), bankCandidate("b2")],
      usage,
    });
    const outcome = await runDailyChallengePipeline({
      dayKey: DAY,
      deps: deps(store, async () => null, echoPiston),
    });
    expect(outcome.status).toBe("bank_fallback");
    expect(rec.created[0]!.prov.bankQuestionId).toBe("b1");
  });

  it("uses the built-in curated pool when AI and the bank are both empty", async () => {
    const { store, rec } = makeStore({ bank: [] });
    const outcome = await runDailyChallengePipeline({
      dayKey: DAY,
      deps: deps(store, async () => null, echoPiston),
    });
    expect(outcome.status).toBe("curated_fallback");
    expect(rec.created[0]!.prov.source).toBe(
      DailyChallengeSource.CURATED_FALLBACK,
    );
    expect(rec.created[0]!.spec.testCases.length).toBeGreaterThan(0);
    expect(rec.created[0]!.prov.generatedAt).toBe(NOW);
  });
});
