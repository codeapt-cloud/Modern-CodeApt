/**
 * Step 36 D — resume-anchored question generation, using the user's ACTUAL resume
 * as the fixture. Asserts the generator produces SPECIFIC, probing questions that
 * reference concrete resume claims (the target style), not generic prompts. The
 * console.log dump is intentional — it's the pasted before/after evidence.
 */
import { InterviewQuestionCategory, buildResumeQuestions } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

// Highlights as a good `analyzeResume` extraction yields them from the fixture.
const ANALYSIS = {
  highlights: [
    "validated the InsightFace attendance engine to zero false positives",
    "built AAMS, a production MERN and FastAPI attendance system at ACE Engineering College",
    "JARVIS falls back across six LLM providers with retry",
    "designed an authority and approval engine for sensitive tool actions with audit logging",
    "built CodeLoop, a Django and Judge0 online judge at 98% accuracy with 100+ concurrent users",
    "minted Cardano CIP-25 credentials with the Mesh SDK at a hackathon",
  ],
  skills: ["Python", "TypeScript", "React", "FastAPI", "Bun", "MediaPipe"],
};

describe("buildResumeQuestions — the fixture resume", () => {
  it("produces resume-specific, probing questions (not generic)", () => {
    const qs = buildResumeQuestions(ANALYSIS, 2, 4);
    console.log("\n--- RESUME-DRIVEN QUESTIONS (fixture) ---\n" + qs.map((q) => `[${q.category}] ${q.text}`).join("\n") + "\n");

    expect(qs).toHaveLength(6);
    const all = qs.map((q) => q.text).join("\n");

    // The two target questions the user asked for, verbatim in intent.
    expect(all).toContain(
      "You validated the InsightFace attendance engine to zero false positives — what was your test set, and what would have made you distrust that number?",
    );
    expect(all).toContain(
      "JARVIS falls back across six LLM providers with retry — how did you decide when to fail over versus retry",
    );

    // Every question names something specific from the resume — none is generic.
    const GENERIC = /tell me about (yourself|a project you)|describe a challenging problem|a time you failed/i;
    for (const q of qs) expect(q.text).not.toMatch(GENERIC);
    // Each references a concrete resume token.
    const TOKENS = /InsightFace|AAMS|JARVIS|CodeLoop|Cardano|authority|Python|TypeScript|React|FastAPI|Bun|MediaPipe/;
    for (const q of qs) expect(q.text).toMatch(TOKENS);
  });

  it("returns [] with no highlights so the caller keeps its role bank", () => {
    expect(buildResumeQuestions({ highlights: [], skills: [] }, 3, 4)).toEqual([]);
    expect(buildResumeQuestions(null, 3, 4)).toEqual([]);
  });

  it("tops up a short bucket from skills, staying resume-specific", () => {
    // One highlight, but 3 technical questions requested → skill-anchored top-ups.
    const qs = buildResumeQuestions(
      { highlights: ["built a Django and Judge0 online judge"], skills: ["Python", "Django"] },
      0,
      3,
    );
    expect(qs).toHaveLength(3);
    expect(qs.every((q) => q.category === InterviewQuestionCategory.TECHNICAL)).toBe(true);
    expect(qs.some((q) => /Python|Django/.test(q.text))).toBe(true);
  });
});
