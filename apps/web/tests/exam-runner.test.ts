/**
 * Unit tests for the pure exam-runner helpers: countdown formatting, the
 * answered/unanswered logic driving the navigator, and answer seeding.
 */
import { ExamQuestionType, type SanitizedQuestion } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  answeredCount,
  clampIndex,
  formatCountdown,
  isAnswered,
  isLastQuestion,
  isLastSection,
  questionStatus,
  saveAndNextAction,
  seedAnswers,
} from "../src/lib/exam-runner.js";

function mcq(id: string): SanitizedQuestion {
  return {
    id,
    type: ExamQuestionType.MCQ_SINGLE,
    text: `Q ${id}`,
    order: 0,
    marks: 5,
    image: "",
    options: ["a", "b", "c"],
    starterCode: null,
    language: null,
    allowedLanguages: [],
    sampleCases: null,
    savedAnswer: null,
  };
}
function code(id: string, starter = "print(1)"): SanitizedQuestion {
  return {
    id,
    type: ExamQuestionType.CODE,
    text: `Code ${id}`,
    order: 0,
    marks: 10,
    image: "",
    options: null,
    starterCode: starter,
    language: "python",
    allowedLanguages: [],
    sampleCases: [],
    savedAnswer: null,
  };
}

describe("formatCountdown", () => {
  it("formats MM:SS under an hour and H:MM:SS over", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(9)).toBe("00:09");
    expect(formatCountdown(75)).toBe("01:15");
    expect(formatCountdown(1799)).toBe("29:59");
    expect(formatCountdown(3661)).toBe("1:01:01");
  });
  it("clamps negatives to zero", () => {
    expect(formatCountdown(-5)).toBe("00:00");
  });
});

describe("isAnswered", () => {
  it("MCQ counts when an option is selected", () => {
    expect(isAnswered(mcq("a"), undefined)).toBe(false);
    expect(isAnswered(mcq("a"), { selectedOptions: [] })).toBe(false);
    expect(isAnswered(mcq("a"), { selectedOptions: [1] })).toBe(true);
  });
  it("CODE counts only with non-whitespace code", () => {
    expect(isAnswered(code("c"), { code: "   " })).toBe(false);
    expect(isAnswered(code("c"), { code: "print(1)" })).toBe(true);
  });
});

describe("answeredCount", () => {
  it("counts answered questions across a section", () => {
    const qs = [mcq("a"), mcq("b"), code("c")];
    const answers = {
      a: { selectedOptions: [0] },
      c: { code: "x=1" },
    };
    expect(answeredCount(qs, answers)).toBe(2);
  });
});

describe("seedAnswers", () => {
  it("seeds from savedAnswer and skips nulls", () => {
    const q: SanitizedQuestion = {
      ...mcq("a"),
      savedAnswer: { selectedOptions: [2], code: null, language: null },
    };
    const seeded = seedAnswers([q, code("c")]);
    expect(seeded.a).toEqual({ selectedOptions: [2] });
    expect(seeded.c).toBeUndefined(); // no saved answer → not seeded
  });
});

describe("isLastSection", () => {
  it("is true only on the final index", () => {
    expect(isLastSection(0, 2)).toBe(false);
    expect(isLastSection(1, 2)).toBe(true);
    expect(isLastSection(2, 2)).toBe(true);
  });
});

describe("questionStatus (4-state navigator)", () => {
  it("derives the four base states from answered/visited/marked", () => {
    // never opened
    expect(questionStatus(false, false, false)).toBe("not-visited");
    // opened, still blank
    expect(questionStatus(false, true, false)).toBe("not-answered");
    // has a saved answer
    expect(questionStatus(true, true, false)).toBe("answered");
    expect(questionStatus(true, false, false)).toBe("answered"); // answered implies opened
  });

  it("marked wins, and carries the answered/unanswered variant", () => {
    expect(questionStatus(false, true, true)).toBe("marked-unanswered");
    expect(questionStatus(true, true, true)).toBe("marked-answered");
    // marked even when not otherwise visited
    expect(questionStatus(false, false, true)).toBe("marked-unanswered");
  });
});

describe("saveAndNextAction (last-question delegates to the section pipeline)", () => {
  it("advances the QUESTION while inside the section", () => {
    expect(saveAndNextAction(0, 3, false)).toBe("next-question");
    expect(saveAndNextAction(1, 3, true)).toBe("next-question");
  });
  it("on the last question of a non-final section → advance-section", () => {
    expect(saveAndNextAction(2, 3, false)).toBe("advance-section");
  });
  it("on the last question of the final section → submit-exam", () => {
    expect(saveAndNextAction(2, 3, true)).toBe("submit-exam");
  });
});

describe("within-section bounds", () => {
  it("isLastQuestion is true only on the final index", () => {
    expect(isLastQuestion(0, 3)).toBe(false);
    expect(isLastQuestion(2, 3)).toBe(true);
  });
  it("clampIndex keeps jumps inside the section", () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(0, 0)).toBe(0); // empty section guard
  });
});
