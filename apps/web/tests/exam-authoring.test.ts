import { CodeLanguage, ExamQuestionType } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  compactOptions,
  decodeCorrectOptions,
  emptyQuestionDraft,
  encodeCorrectOptions,
  fieldsForType,
  isCode,
  isMcq,
  toQuestionUpsert,
  validateQuestionDraft,
  type QuestionDraft,
} from "../src/lib/exam-authoring.js";

describe("fieldsForType", () => {
  it("MCQ_SINGLE renders options with single-pick correct, no code/tests", () => {
    const s = fieldsForType(ExamQuestionType.MCQ_SINGLE);
    expect(s).toEqual({
      options: true,
      correct: true,
      singleCorrect: true,
      starterCode: false,
      language: false,
      testCases: false,
    });
  });

  it("MCQ_MULTI renders options with multi-pick correct", () => {
    const s = fieldsForType(ExamQuestionType.MCQ_MULTI);
    expect(s.options).toBe(true);
    expect(s.correct).toBe(true);
    expect(s.singleCorrect).toBe(false);
    expect(s.testCases).toBe(false);
  });

  it("CODE renders starterCode/language/testCases, no options", () => {
    const s = fieldsForType(ExamQuestionType.CODE);
    expect(s).toEqual({
      options: false,
      correct: false,
      singleCorrect: false,
      starterCode: true,
      language: true,
      testCases: true,
    });
  });

  it("isMcq / isCode classify the three types", () => {
    expect(isMcq(ExamQuestionType.MCQ_SINGLE)).toBe(true);
    expect(isMcq(ExamQuestionType.MCQ_MULTI)).toBe(true);
    expect(isMcq(ExamQuestionType.CODE)).toBe(false);
    expect(isCode(ExamQuestionType.CODE)).toBe(true);
    expect(isCode(ExamQuestionType.MCQ_SINGLE)).toBe(false);
  });
});

describe("compactOptions", () => {
  it("drops blank rows and remaps correct indices to compacted positions", () => {
    // rows: [A, "", B, C] with correct pointing at B(2) and C(3)
    const { options, correct } = compactOptions(
      ["A", "  ", "B", "C"],
      [2, 3],
    );
    expect(options).toEqual(["A", "B", "C"]);
    // B was index 2 → now 1; C was 3 → now 2
    expect(correct).toEqual([1, 2]);
  });

  it("discards correct indices that pointed at removed blanks", () => {
    const { options, correct } = compactOptions(["A", "", "B"], [1, 2]);
    expect(options).toEqual(["A", "B"]);
    // index 1 was blank (dropped); index 2 (B) → now 1
    expect(correct).toEqual([1]);
  });

  it("trims surviving option text", () => {
    const { options } = compactOptions(["  A  ", "B"], []);
    expect(options).toEqual(["A", "B"]);
  });
});

describe("encodeCorrectOptions", () => {
  it("SINGLE keeps exactly one (lowest) index", () => {
    expect(encodeCorrectOptions(ExamQuestionType.MCQ_SINGLE, [2])).toEqual([2]);
    expect(encodeCorrectOptions(ExamQuestionType.MCQ_SINGLE, [3, 1])).toEqual([
      1,
    ]);
    expect(encodeCorrectOptions(ExamQuestionType.MCQ_SINGLE, [])).toEqual([]);
  });

  it("MULTI keeps a unique, sorted set", () => {
    expect(
      encodeCorrectOptions(ExamQuestionType.MCQ_MULTI, [3, 1, 1, 0]),
    ).toEqual([0, 1, 3]);
  });
});

describe("decodeCorrectOptions", () => {
  it("copies stored indices; null → empty", () => {
    expect(decodeCorrectOptions([0, 2])).toEqual([0, 2]);
    expect(decodeCorrectOptions(null)).toEqual([]);
    expect(decodeCorrectOptions(undefined)).toEqual([]);
  });
});

describe("validateQuestionDraft", () => {
  const base = emptyQuestionDraft(ExamQuestionType.MCQ_SINGLE);

  it("requires question text", () => {
    const errors = validateQuestionDraft({ ...base, text: "   " });
    expect(errors.text).toBeDefined();
  });

  it("MCQ needs at least two options", () => {
    const draft: QuestionDraft = {
      ...base,
      text: "Q",
      options: ["only one", "", "", ""],
      correctOptions: [0],
    };
    expect(validateQuestionDraft(draft).options).toBeDefined();
  });

  it("MCQ_SINGLE needs exactly one correct option", () => {
    const draft: QuestionDraft = {
      ...base,
      text: "Q",
      options: ["A", "B", "", ""],
      correctOptions: [],
    };
    expect(validateQuestionDraft(draft).correctOptions).toBeDefined();
    expect(
      validateQuestionDraft({ ...draft, correctOptions: [1] }).correctOptions,
    ).toBeUndefined();
  });

  it("MCQ_MULTI needs at least one correct option", () => {
    const draft: QuestionDraft = {
      ...emptyQuestionDraft(ExamQuestionType.MCQ_MULTI),
      text: "Q",
      options: ["A", "B", "C", ""],
      correctOptions: [0, 2],
    };
    expect(validateQuestionDraft(draft)).toEqual({});
  });

  it("CODE ignores option rules; only text + marks matter", () => {
    const draft = emptyQuestionDraft(ExamQuestionType.CODE);
    expect(validateQuestionDraft({ ...draft, text: "Solve it" })).toEqual({});
    expect(validateQuestionDraft({ ...draft, text: "" }).text).toBeDefined();
  });

  it("rejects negative / non-integer marks", () => {
    expect(
      validateQuestionDraft({ ...base, text: "Q", options: ["A", "B", "", ""], correctOptions: [0], marks: -1 })
        .marks,
    ).toBeDefined();
  });
});

describe("toQuestionUpsert", () => {
  it("MCQ_SINGLE compacts options and encodes a single correct index", () => {
    const draft: QuestionDraft = {
      type: ExamQuestionType.MCQ_SINGLE,
      text: "  Pick one  ",
      marks: 5,
      options: ["A", "", "B", "C"],
      correctOptions: [2], // B (post-compaction → index 1)
      starterCode: "",
      language: CodeLanguage.PYTHON,
      allowedLanguages: [],
      image: "",
    };
    const payload = toQuestionUpsert(draft, "sec1", 3);
    expect(payload).toEqual({
      sectionId: "sec1",
      type: ExamQuestionType.MCQ_SINGLE,
      text: "Pick one",
      order: 3,
      marks: 5,
      options: ["A", "B", "C"],
      correctOptions: [1],
      starterCode: "",
      language: CodeLanguage.PYTHON,
      allowedLanguages: [],
      image: "",
    });
  });

  it("MCQ_MULTI sends a sorted set of indices", () => {
    const draft: QuestionDraft = {
      type: ExamQuestionType.MCQ_MULTI,
      text: "Pick many",
      marks: 10,
      options: ["A", "B", "C", "D"],
      correctOptions: [3, 0],
      starterCode: "",
      language: CodeLanguage.PYTHON,
      allowedLanguages: [],
      image: "",
    };
    const payload = toQuestionUpsert(draft, "sec1", 0);
    expect(payload.options).toEqual(["A", "B", "C", "D"]);
    expect(payload.correctOptions).toEqual([0, 3]);
    expect(payload.allowedLanguages).toEqual([]); // MCQ is never language-locked
  });

  it("CODE (open policy) omits options and carries an empty allowedLanguages", () => {
    const draft: QuestionDraft = {
      type: ExamQuestionType.CODE,
      text: "Reverse a string",
      marks: 20,
      options: [],
      correctOptions: [],
      starterCode: "def solve():\n    pass",
      language: CodeLanguage.JAVASCRIPT,
      allowedLanguages: [], // open
      image: "",
    };
    const payload = toQuestionUpsert(draft, "sec2", 1);
    expect(payload.options).toBeUndefined();
    expect(payload.correctOptions).toBeUndefined();
    expect(payload.starterCode).toBe("def solve():\n    pass");
    expect(payload.language).toBe(CodeLanguage.JAVASCRIPT);
    expect(payload.type).toBe(ExamQuestionType.CODE);
    expect(payload.allowedLanguages).toEqual([]);
  });

  it("CODE (locked policy) locks allowedLanguages to the authored language", () => {
    const draft: QuestionDraft = {
      type: ExamQuestionType.CODE,
      text: "Reverse a string",
      marks: 20,
      options: [],
      correctOptions: [],
      starterCode: "// ...",
      language: CodeLanguage.JAVA,
      allowedLanguages: [CodeLanguage.JAVA], // locked
      image: "",
    };
    const payload = toQuestionUpsert(draft, "sec2", 1);
    expect(payload.allowedLanguages).toEqual([CodeLanguage.JAVA]);
    expect(payload.language).toBe(CodeLanguage.JAVA);
  });
});
