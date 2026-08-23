/**
 * Unit tests for the pure email scoring engine (@codeapt/shared, Communication
 * module). Covers: the email weight table sums to 1.00; each deterministic
 * dimension scores sensibly on good vs bad samples; the deterministic-only
 * grade is a complete, honest result; and blendEmailHybrid touches ONLY content
 * and tone (mechanics + format + register can never be moved by the model).
 * No I/O — pure functions of text + reference keywords.
 */
import {
  EMAIL_AI_BLEND,
  EMAIL_SCORE_WEIGHTS,
  blendEmailHybrid,
  scoreEmailDeterministic,
  scoreEmailFormat,
  scoreEmailRegister,
  scoreEmailToneBaseline,
  type EmailDimensionScores,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

const KEYWORDS = ["invoice", "payment", "refund", "account", "resolve"];

const GOOD_EMAIL = [
  "Subject: Request to resolve a duplicate invoice payment",
  "",
  "Dear Ms. Sharma,",
  "",
  "I am writing regarding invoice 4821 on my account, which appears to have",
  "been charged twice. I would be grateful if you could review the duplicate",
  "payment and process a refund for the extra amount.",
  "",
  "Please let me know if you need any further details from my side. I would",
  "appreciate a resolution by the end of the week.",
  "",
  "Kind regards,",
  "Anita Rao",
].join("\n");

const BAD_EMAIL =
  "hey gonna need my money back ASAP!!! u charged me TWICE and its NOT ok, " +
  "sort it out cuz im really annoyed";

describe("email weight table", () => {
  it("sums to 1.00", () => {
    const sum = Object.values(EMAIL_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });
});

describe("deterministic email dimensions score sensibly", () => {
  it("format: a well-formed email beats an unstructured blob", () => {
    expect(scoreEmailFormat(GOOD_EMAIL)).toBeGreaterThan(75);
    expect(scoreEmailFormat(BAD_EMAIL)).toBeLessThan(40);
  });

  it("register: formal prose beats contractions / slang / ALL-CAPS", () => {
    expect(scoreEmailRegister(GOOD_EMAIL)).toBeGreaterThan(85);
    expect(scoreEmailRegister(BAD_EMAIL)).toBeLessThan(50);
  });

  it("tone: courteous email beats a rude, shouting one", () => {
    expect(scoreEmailToneBaseline(GOOD_EMAIL)).toBeGreaterThan(
      scoreEmailToneBaseline(BAD_EMAIL),
    );
    expect(scoreEmailToneBaseline(GOOD_EMAIL)).toBeGreaterThan(70);
  });

  it("content: on-topic email covers the scenario keywords, off-topic does not", () => {
    const onTopic = scoreEmailDeterministic(GOOD_EMAIL, {
      referenceKeywords: KEYWORDS,
    });
    const offTopic = scoreEmailDeterministic(
      "Subject: Lunch\n\nDear team,\n\nShall we get pizza today?\n\nRegards,\nSam",
      { referenceKeywords: KEYWORDS },
    );
    expect(onTopic.dimensions.content).toBeGreaterThan(
      offTopic.dimensions.content,
    );
  });
});

describe("scoreEmailDeterministic — a complete, honest grade", () => {
  it("returns all eight dimensions, a bounded total, and text stats", () => {
    const r = scoreEmailDeterministic(GOOD_EMAIL, { referenceKeywords: KEYWORDS });
    const keys = Object.keys(r.dimensions).sort();
    expect(keys).toEqual(
      [
        "content",
        "format",
        "grammar",
        "punctuation",
        "readability",
        "register",
        "spelling",
        "tone",
      ].sort(),
    );
    for (const v of Object.values(r.dimensions)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.wordCount).toBeGreaterThan(0);
    // A good email is a strong deterministic-only grade with NO AI at all.
    expect(r.total).toBeGreaterThan(65);
  });

  it("no reference keywords → content is neutral (never drags the score down)", () => {
    const r = scoreEmailDeterministic(GOOD_EMAIL, { referenceKeywords: [] });
    expect(r.dimensions.content).toBe(100);
  });
});

describe("blendEmailHybrid — mechanics + structure are never AI-touched", () => {
  it("blends ONLY content and tone; leaves the other six deterministic", () => {
    const det = scoreEmailDeterministic(GOOD_EMAIL, {
      referenceKeywords: KEYWORDS,
    }).dimensions;
    // A hostile AI payload trying to move every dimension, including mechanics.
    const ai: Partial<EmailDimensionScores> = {
      grammar: 0,
      spelling: 0,
      punctuation: 0,
      readability: 0,
      format: 0,
      register: 0,
      content: 100,
      tone: 100,
    };
    const blended = blendEmailHybrid(ai, det);
    // Untouched: mechanics + the two structural deterministic dimensions.
    expect(blended.dimensions.grammar).toBe(det.grammar);
    expect(blended.dimensions.spelling).toBe(det.spelling);
    expect(blended.dimensions.punctuation).toBe(det.punctuation);
    expect(blended.dimensions.readability).toBe(det.readability);
    expect(blended.dimensions.format).toBe(det.format);
    expect(blended.dimensions.register).toBe(det.register);
    // Blended toward the AI value by exactly the configured blend weight.
    expect(blended.dimensions.content).toBeCloseTo(
      det.content * (1 - EMAIL_AI_BLEND.content) + 100 * EMAIL_AI_BLEND.content,
      2,
    );
    expect(blended.dimensions.tone).toBeCloseTo(
      det.tone * (1 - EMAIL_AI_BLEND.tone) + 100 * EMAIL_AI_BLEND.tone,
      2,
    );
  });

  it("with no AI dimensions, the blend equals the deterministic breakdown", () => {
    const det = scoreEmailDeterministic(GOOD_EMAIL, {
      referenceKeywords: KEYWORDS,
    });
    const blended = blendEmailHybrid({}, det.dimensions);
    expect(blended.dimensions).toEqual(det.dimensions);
    expect(blended.total).toBe(det.total);
  });
});
