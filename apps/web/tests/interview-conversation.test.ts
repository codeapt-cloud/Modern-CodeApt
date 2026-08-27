/**
 * Step 35 F — the conversational fallback phrase bank + composition. When the AI
 * is unavailable the interview must still greet by name, acknowledge neutrally,
 * transition, and close. Acknowledgements must never imply a score.
 */
import {
  composeSpokenQuestion,
  firstNameFor,
  interviewAcknowledgement,
  interviewClosing,
  interviewGreeting,
  interviewTransition,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("firstNameFor", () => {
  it("takes the first token and strips noise", () => {
    expect(firstNameFor("Vinay Kumar")).toBe("Vinay");
    expect(firstNameFor("  aisha   patel ")).toBe("aisha");
    expect(firstNameFor("O'Brien")).toBe("O'Brien");
    expect(firstNameFor("")).toBe("");
    expect(firstNameFor(null)).toBe("");
  });
});

describe("greeting / closing fallbacks", () => {
  it("greeting uses the first name when available, and is safe without one", () => {
    expect(interviewGreeting("Vinay Kumar")).toContain("Vinay");
    expect(interviewGreeting("Vinay Kumar").toLowerCase()).toContain("hello");
    expect(interviewGreeting("")).not.toContain("undefined");
    expect(interviewGreeting("").toLowerCase()).toContain("hello");
  });

  it("closing is a neutral sign-off", () => {
    expect(interviewClosing(0).toLowerCase()).toMatch(/thank|done|wrap/);
  });
});

describe("acknowledgements are neutral and varied (never a verdict)", () => {
  it("varies by seed and never praises/judges", () => {
    const a = interviewAcknowledgement(0);
    const b = interviewAcknowledgement(1);
    expect(a).not.toBe(b); // varied
    // No approval/quality words that would imply a score.
    const banned = /\b(good|great|excellent|correct|wrong|impressive|well done|nice)\b/i;
    for (let s = 0; s < 12; s += 1) {
      expect(interviewAcknowledgement(s)).not.toMatch(banned);
    }
  });

  it("selection is deterministic (same seed → same phrase)", () => {
    expect(interviewAcknowledgement(3)).toBe(interviewAcknowledgement(3));
    expect(interviewTransition(2, false)).toBe(interviewTransition(2, false));
    // A negative seed doesn't throw or return undefined.
    expect(typeof interviewAcknowledgement(-1)).toBe("string");
  });
});

describe("composeSpokenQuestion", () => {
  it("prefixes the acknowledgement, or speaks just the question when none", () => {
    expect(composeSpokenQuestion("Thanks for that.", "What did you do next?")).toBe(
      "Thanks for that. What did you do next?",
    );
    expect(composeSpokenQuestion("", "What next?")).toBe("What next?");
    expect(composeSpokenQuestion(null, "  What next?  ")).toBe("What next?");
  });
});
