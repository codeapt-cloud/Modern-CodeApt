/**
 * Import-template DRIFT GUARDS. Each downloadable bulk-upload template is
 * generated FROM the parser's expected header names (co-located in the same
 * `lib/*-excel.ts`), so it can't drift. These tests prove that by ROUND-TRIPPING:
 * generate the template workbook → parse it back with the REAL parser → assert
 * it imports cleanly with the example rows intact. If a parser's expected
 * columns ever change without the template following, a test here breaks.
 *
 * Pure lib functions — no Mongo, no HTTP.
 */
import { ExamQuestionType } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  CODING_TEMPLATE_COLUMNS,
  MCQ_TEMPLATE_COLUMNS,
  buildCodingTemplateWorkbook,
  buildMcqTemplateWorkbook,
  parseCodingWorkbook,
  parseMcqWorkbook,
} from "../src/lib/exam-excel.js";
import {
  CHALLENGE_TEMPLATE_COLUMNS,
  buildChallengeTemplateWorkbook,
  parseChallengeWorkbook,
} from "../src/lib/challenge-excel.js";
import {
  TOPIC_TEMPLATE_COLUMNS,
  buildTopicTemplateWorkbook,
  parseTopicWorkbook,
} from "../src/lib/topic-excel.js";
import {
  ROSTER_TEMPLATE_COLUMNS,
  buildRosterTemplateWorkbook,
  parseRosterWorkbook,
} from "../src/lib/roster-excel.js";

describe("MCQ template ↔ parser", () => {
  it("round-trips: the MCQ template parses cleanly (single + multi answer)", async () => {
    const buf = await buildMcqTemplateWorkbook();
    const { questions, errors } = await parseMcqWorkbook(buf);

    expect(errors).toEqual([]);
    expect(questions).toHaveLength(2);

    const single = questions[0];
    expect(single.type).toBe(ExamQuestionType.MCQ_SINGLE);
    expect(single.sectionName).toBe("Aptitude");
    expect(single.options).toEqual(["3", "4", "5", "6"]);
    expect(single.correctOptions).toEqual([1]); // "2" 1-based → 0-based 1

    const multi = questions[1];
    expect(multi.type).toBe(ExamQuestionType.MCQ_MULTI);
    expect(multi.correctOptions).toEqual([0, 2]); // "1,3" → [0,2]
  });

  it("MCQ template columns are the flat MCQ-only header (no code/ref)", () => {
    expect(MCQ_TEMPLATE_COLUMNS).toEqual([
      "section",
      "sectionDuration",
      "order",
      "text",
      "marks",
      "option1",
      "option2",
      "option3",
      "option4",
      "option5",
      "correctOptions",
    ]);
  });
});

describe("coding template ↔ parser", () => {
  it("round-trips: the coding template parses cleanly with INLINE test cases", async () => {
    const buf = await buildCodingTemplateWorkbook();
    const { questions, errors } = await parseCodingWorkbook(buf);

    expect(errors).toEqual([]);
    expect(questions).toHaveLength(1);

    const code = questions[0];
    expect(code.type).toBe(ExamQuestionType.CODE);
    expect(code.sectionName).toBe("Coding");
    expect(code.language).toBe("python");
    expect(code.allowedLanguages).toEqual(["python"]);
    // Two inline test cases (blank triples 3-5 skipped), the second hidden.
    expect(code.testCases).toHaveLength(2);
    expect(code.testCases[0]).toMatchObject({
      input: "2 3",
      expectedOutput: "5",
      isHidden: false,
    });
    expect(code.testCases[1].isHidden).toBe(true);
  });

  it("coding template columns are flat with 5 inline test-case triples (no ref/sheet)", () => {
    expect(CODING_TEMPLATE_COLUMNS.slice(0, 8)).toEqual([
      "section",
      "sectionDuration",
      "order",
      "text",
      "marks",
      "starterCode",
      "language",
      "allowedLanguages",
    ]);
    expect(CODING_TEMPLATE_COLUMNS).toContain("input1");
    expect(CODING_TEMPLATE_COLUMNS).toContain("hidden5");
    expect(CODING_TEMPLATE_COLUMNS).not.toContain("ref");
  });
});

describe("daily-challenge template ↔ parser", () => {
  it("round-trips: the template parses into the example rows", async () => {
    const buf = await buildChallengeTemplateWorkbook();
    const { rows, errors } = await parseChallengeWorkbook(buf);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);

    const mcq = rows.find((r) => r.type === "mcq");
    expect(mcq).toBeDefined();
    expect(mcq!.title).toBe("Time complexity of binary search");
    expect(mcq!.correct).toBe("2");
    expect(mcq!.options).toContain("O(log n)");

    const code = rows.find((r) => r.type === "code");
    expect(code).toBeDefined();
    expect(code!.language).toBe("python");
    expect(code!.starterCode).not.toBe("");
    expect(code!.cases).toContain("2 3=>5");
  });

  it("template columns match the parser's accepted headers", () => {
    expect(CHALLENGE_TEMPLATE_COLUMNS).toEqual([
      "type",
      "date",
      "title",
      "description",
      "marks",
      "options",
      "correct",
      "starter_code",
      "language",
      "cases",
    ]);
  });
});

describe("curriculum topics template ↔ parser", () => {
  it("round-trips: the template parses into the example rows", async () => {
    const buf = await buildTopicTemplateWorkbook();
    const { rows, errors } = await parseTopicWorkbook(buf);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);

    const text = rows.find((r) => r.type === "text");
    expect(text).toBeDefined();
    expect(text!.module).toBe("Getting Started");
    expect(text!.name).toBe("Welcome & setup");

    const video = rows.find((r) => r.type === "video");
    expect(video).toBeDefined();
    expect(video!.video).toBe("dQw4w9WgXcQ");
  });

  it("template columns match the parser's accepted headers", () => {
    expect(TOPIC_TEMPLATE_COLUMNS).toEqual([
      "module",
      "name",
      "type",
      "content",
      "video_id",
      "duration",
      "order",
    ]);
  });
});

describe("bulk-enroll roster template ↔ parser", () => {
  it("round-trips: the template parses into the example row", async () => {
    const buf = await buildRosterTemplateWorkbook();
    const { rows, errors } = await parseRosterWorkbook(buf);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      username: "asha.rao",
      email: "asha@college.edu",
      fullName: "Asha Rao",
      rollNumber: "CS2026001",
      state: "KA",
    });
  });

  it("template columns match the parser's accepted headers", () => {
    expect(ROSTER_TEMPLATE_COLUMNS).toEqual([
      "username",
      "email",
      "full_name",
      "college_name",
      "roll_number",
      "phone_number",
      "state",
      "bio",
    ]);
  });
});
