/**
 * Exam bulk-upload parsers (Phase: two-format clean break) — pure-lib coverage of
 * `parseMcqWorkbook` + `parseCodingWorkbook`: MCQ single/multi + validation
 * errors, coding with INLINE test cases (hidden + fewer-than-5 + none), and
 * section order assigned by first appearance. No Mongo/HTTP.
 */
import { ExamQuestionType } from "@codeapt/shared";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  CODING_TEMPLATE_COLUMNS,
  MCQ_TEMPLATE_COLUMNS,
  parseCodingWorkbook,
  parseMcqWorkbook,
} from "../src/lib/exam-excel.js";

async function sheetToBuffer(
  header: readonly string[],
  rows: (string | number)[][],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow([...header]);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseMcqWorkbook", () => {
  it("reads single + multi answers and assigns section order by appearance", async () => {
    const buf = await sheetToBuffer(MCQ_TEMPLATE_COLUMNS, [
      ["Verbal", 20, 0, "Synonym of fast?", 5, "slow", "quick", "late", "", "", "2"],
      ["Logic", 25, 0, "Which are even?", 5, "1", "2", "3", "4", "", "2,4"],
      ["Verbal", 20, 1, "Antonym of hot?", 5, "cold", "warm", "", "", "", "1"],
    ]);
    const { questions, errors } = await parseMcqWorkbook(buf);
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(3);

    expect(questions[0].type).toBe(ExamQuestionType.MCQ_SINGLE);
    expect(questions[0].correctOptions).toEqual([1]);
    expect(questions[1].type).toBe(ExamQuestionType.MCQ_MULTI);
    expect(questions[1].correctOptions).toEqual([1, 3]);

    // Section order: Verbal first seen (0), Logic second (1) — Verbal row 3 reuses 0.
    expect(questions[0].sectionOrder).toBe(0);
    expect(questions[1].sectionOrder).toBe(1);
    expect(questions[2].sectionName).toBe("Verbal");
    expect(questions[2].sectionOrder).toBe(0);
  });

  it("flags rows with <2 options or no valid correct option", async () => {
    const buf = await sheetToBuffer(MCQ_TEMPLATE_COLUMNS, [
      ["S", 20, 0, "Too few options", 5, "only one", "", "", "", "", "1"],
      ["S", 20, 1, "No correct marked", 5, "a", "b", "c", "", "", ""],
      ["S", 20, 2, "Out-of-range correct", 5, "a", "b", "", "", "", "9"],
    ]);
    const { questions, errors } = await parseMcqWorkbook(buf);
    expect(questions).toHaveLength(0);
    expect(errors).toHaveLength(3);
    expect(errors[0].message).toMatch(/at least 2 options/i);
    expect(errors[1].message).toMatch(/correctOption/i);
    expect(errors[2].message).toMatch(/correctOption/i); // "9" out of range → none valid
  });
});

describe("parseCodingWorkbook", () => {
  it("reads inline test cases (hidden + fewer-than-5) and the language policy", async () => {
    const buf = await sheetToBuffer(CODING_TEMPLATE_COLUMNS, [
      [
        "Code", 45, 0, "Sum two ints", 10, "# code", "python", "java",
        "2 3", "5", "false", // tc1 visible
        "9 9", "18", "yes", // tc2 hidden (yes)
        "", "", "", "", "", "", "", "", "", // tc3-5 blank
      ],
    ]);
    const { questions, errors } = await parseCodingWorkbook(buf);
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(1);
    const q = questions[0];
    expect(q.type).toBe(ExamQuestionType.CODE);
    expect(q.language).toBe("python");
    expect(q.allowedLanguages).toEqual(["java"]); // single lang → LOCKED
    expect(q.testCases).toHaveLength(2);
    expect(q.testCases[0].isHidden).toBe(false);
    expect(q.testCases[1].isHidden).toBe(true);
  });

  it("accepts a coding question with NO test cases and an OPEN language policy", async () => {
    const buf = await sheetToBuffer(CODING_TEMPLATE_COLUMNS, [
      [
        "Code", 45, 0, "Print hello", 10, "# code", "python", "", // allowedLanguages blank → open
        "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
      ],
    ]);
    const { questions, errors } = await parseCodingWorkbook(buf);
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(1);
    expect(questions[0].testCases).toHaveLength(0);
    expect(questions[0].allowedLanguages).toEqual([]); // open
  });

  it("flags a coding row missing its question text", async () => {
    const buf = await sheetToBuffer(CODING_TEMPLATE_COLUMNS, [
      ["Code", 45, 0, "", 10, "# has starter but no text", "python", "",
        "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]);
    const { questions, errors } = await parseCodingWorkbook(buf);
    expect(questions).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/text/i);
  });
});
