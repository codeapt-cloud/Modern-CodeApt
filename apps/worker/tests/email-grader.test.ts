/**
 * Email grader orchestration tests (Communication module) — no network.
 * Mirrors essay-grader.test. Verifies:
 *   - a successful AI adapter → source `ai_hybrid` with content/tone blended,
 *   - an adapter that throws OR returns null → source `deterministic_fallback`
 *     (this is how an email grade "degrades" when AI is unavailable),
 *   - `aiEnabled:false` → deterministic-only, the AI adapter is NEVER called,
 *   - mechanics + format + register are never moved by the model,
 *   - the default `mock` adapter is deterministic and offline.
 */
import {
  EMAIL_AI_BLEND,
  EssayScoreSource,
  blendEmailHybrid,
  scoreEmailDeterministic,
} from "@codeapt/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isKnownWord } from "../src/lib/dictionary.js";
import {
  createMockEmailGrader,
  gradeEmail,
  selectEmailGrader,
  type EmailGrader,
} from "../src/lib/email-grader.js";

const KEYWORDS = ["invoice", "payment", "refund", "resolve"];
const EMAIL = [
  "Subject: Duplicate invoice payment",
  "",
  "Dear Ms. Sharma,",
  "",
  "Invoice 4821 on my account was charged twice. I would be grateful if you",
  "could review the duplicate payment and process a refund.",
  "",
  "Kind regards,",
  "Anita Rao",
].join("\n");

const INPUT = {
  emailText: EMAIL,
  prompt: "Write to billing to resolve a duplicate charge.",
  rubric: "content + tone",
  referenceKeywords: KEYWORDS,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gradeEmail orchestration", () => {
  it("AI success → ai_hybrid, content/tone blended vs the deterministic floor", async () => {
    const stub: EmailGrader = {
      gradeWithAI: async () => ({
        dimensions: { content: 95, tone: 90 },
        feedback: "Clear and courteous.",
      }),
    };
    const det = scoreEmailDeterministic(
      EMAIL,
      { referenceKeywords: KEYWORDS },
      { isKnownWord },
    );
    const expected = blendEmailHybrid({ content: 95, tone: 90 }, det.dimensions);

    const result = await gradeEmail(INPUT, stub);
    expect(result.source).toBe(EssayScoreSource.AI_HYBRID);
    expect(result.feedback).toBe("Clear and courteous.");
    expect(result.dimensions).toEqual(expected.dimensions);
    expect(result.total).toBeCloseTo(expected.total, 6);
    // Mechanics + the two structural deterministic dimensions are untouched.
    expect(result.dimensions.grammar).toBe(det.dimensions.grammar);
    expect(result.dimensions.format).toBe(det.dimensions.format);
    expect(result.dimensions.register).toBe(det.dimensions.register);
    // The blend uses the documented ratios.
    expect(EMAIL_AI_BLEND).toEqual({ content: 0.6, tone: 0.5 });
  });

  it("AI throws → deterministic_fallback (a complete, honest grade)", async () => {
    const throwing: EmailGrader = {
      gradeWithAI: async () => {
        throw new Error("AI down / timeout");
      },
    };
    const det = scoreEmailDeterministic(
      EMAIL,
      { referenceKeywords: KEYWORDS },
      { isKnownWord },
    );
    const result = await gradeEmail(INPUT, throwing);
    expect(result.source).toBe(EssayScoreSource.DETERMINISTIC_FALLBACK);
    expect(result.total).toBe(det.total);
    expect(result.dimensions).toEqual(det.dimensions);
    expect(result.feedback).toMatch(/AI analysis unavailable/i);
  });

  it("AI returns null → deterministic_fallback", async () => {
    const nullish: EmailGrader = { gradeWithAI: async () => null };
    const det = scoreEmailDeterministic(
      EMAIL,
      { referenceKeywords: KEYWORDS },
      { isKnownWord },
    );
    const result = await gradeEmail(INPUT, nullish);
    expect(result.source).toBe(EssayScoreSource.DETERMINISTIC_FALLBACK);
    expect(result.total).toBe(det.total);
  });

  it("aiEnabled:false → deterministic-only, the AI adapter is NEVER called", async () => {
    const gradeWithAI = vi.fn(async () => ({
      dimensions: { content: 99, tone: 99 },
      feedback: "should not be used",
    }));
    const det = scoreEmailDeterministic(
      EMAIL,
      { referenceKeywords: KEYWORDS },
      { isKnownWord },
    );
    const result = await gradeEmail({ ...INPUT, aiEnabled: false }, { gradeWithAI });
    expect(gradeWithAI).not.toHaveBeenCalled(); // no provider call → zero tokens
    expect(result.source).toBe(EssayScoreSource.DETERMINISTIC_FALLBACK);
    expect(result.total).toBe(det.total);
    expect(result.dimensions).toEqual(det.dimensions);
    expect(result.feedback).toMatch(/AI grading is disabled/i);
  });
});

describe("mock email grader", () => {
  it("selectEmailGrader() defaults to the offline mock adapter", async () => {
    expect(selectEmailGrader()).toBeDefined();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await gradeEmail(INPUT);
    expect(result.source).toBe(EssayScoreSource.AI_HYBRID);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is deterministic (same text → same analysis) and offline", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const grader = createMockEmailGrader();
    const a = await grader.gradeWithAI(INPUT);
    const b = await grader.gradeWithAI(INPUT);
    expect(a).toEqual(b);
    expect(a?.dimensions.content).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
