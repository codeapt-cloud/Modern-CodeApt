/**
 * Excel tooling for the QUESTION BANK importer. It REUSES the exam importer's
 * type-specific field parsing (`readMcqCore` / `readCodingCore` from
 * exam-excel.ts) — the drift-prone answer/test-case logic is shared, not
 * duplicated — and only differs in the "common" columns: the bank has
 * BANK-METADATA columns (category, subCategory, company, difficulty, tags)
 * INSTEAD of the exam's section columns (section, sectionDuration, order).
 *
 * Two single-sheet formats, one per question TYPE (mirrors the exam split):
 *
 * MCQ bank sheet:
 *   category | subCategory | company | difficulty | tags | text | marks
 *     | option1..option5 | correctOptions
 * Coding bank sheet:
 *   category | subCategory | company | difficulty | tags | text | marks
 *     | starterCode | language | allowedLanguages
 *     | input1 | expected1 | hidden1 | … | input5 | expected5 | hidden5
 *
 * `correctOptions` is a 1-BASED comma list (single→MCQ_SINGLE, multi→MCQ_MULTI);
 * `tags` is a comma-separated list; `difficulty` is easy|medium|hard (default
 * medium); coding test cases are INLINE (1–5, blank triples skipped). This is
 * THE categorized import format the seed dataset must match.
 */
import {
  QUESTION_DIFFICULTY_VALUES,
  QuestionDifficulty,
  type CodeLanguage,
  type ExamBulkUploadKind,
  type ExamQuestionType as ExamQuestionTypeT,
  type QuestionDifficulty as QuestionDifficultyT,
} from "@codeapt/shared";
import ExcelJS from "exceljs";

import {
  cellNumber,
  cellString,
  headerIndex,
  readCodingCore,
  readMcqCore,
  type ParsedTestCase,
  type RowError,
} from "./exam-excel.js";

export interface ParsedBankQuestion {
  ref: string;
  // --- Bank metadata ---
  category: string;
  subCategory: string;
  company: string;
  difficulty: QuestionDifficultyT;
  tags: string[];
  // --- Payload (mirrors ExamQuestion) ---
  type: ExamQuestionTypeT;
  text: string;
  marks: number;
  options?: string[];
  correctOptions?: number[];
  starterCode: string;
  language: CodeLanguage;
  allowedLanguages: CodeLanguage[];
  testCases: ParsedTestCase[];
}
export interface BankParseResult {
  questions: ParsedBankQuestion[];
  errors: RowError[];
}

function parseDifficulty(raw: string): QuestionDifficultyT {
  const v = raw.trim().toLowerCase();
  return (QUESTION_DIFFICULTY_VALUES as string[]).includes(v)
    ? (v as QuestionDifficultyT)
    : QuestionDifficulty.MEDIUM;
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Read the bank-metadata + text/marks columns common to both bank sheets. */
function readBankCommon(
  row: ExcelJS.Row,
  h: Record<string, number>,
): {
  category: string;
  subCategory: string;
  company: string;
  difficulty: QuestionDifficultyT;
  tags: string[];
  text: string;
  marks: number;
} {
  return {
    category: cellString(row, h.category ?? 1),
    subCategory: cellString(row, h.subCategory ?? 2),
    company: cellString(row, h.company ?? 3) || "General",
    difficulty: parseDifficulty(cellString(row, h.difficulty ?? 4)),
    tags: parseTags(cellString(row, h.tags ?? 5)),
    text: cellString(row, h.text ?? 6),
    marks: cellNumber(row, h.marks ?? 7) ?? 5,
  };
}

export async function parseBankMcqWorkbook(
  buffer: Buffer,
): Promise<BankParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.worksheets[0];
  if (!sheet) {
    return {
      questions: [],
      errors: [{ sheet: "MCQ", row: 0, message: "The workbook has no sheets" }],
    };
  }

  const h = headerIndex(sheet.getRow(1));
  const questions: ParsedBankQuestion[] = [];
  const errors: RowError[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const c = readBankCommon(row, h);
    const hasAny =
      c.category || c.text || cellString(row, h.option1 ?? 8);
    if (!hasAny) return; // blank row

    if (!c.category) {
      errors.push({ sheet: "MCQ", row: rowNumber, message: "Missing category" });
      return;
    }
    if (!c.text) {
      errors.push({
        sheet: "MCQ",
        row: rowNumber,
        message: "Missing question text",
      });
      return;
    }
    const mcq = readMcqCore(row, h);
    if (!mcq.ok) {
      errors.push({ sheet: "MCQ", row: rowNumber, message: mcq.message });
      return;
    }

    questions.push({
      ref: `row-${rowNumber}`,
      category: c.category,
      subCategory: c.subCategory,
      company: c.company,
      difficulty: c.difficulty,
      tags: c.tags,
      type: mcq.type,
      text: c.text,
      marks: c.marks,
      options: mcq.options,
      correctOptions: mcq.correctOptions,
      starterCode: "",
      language: "python" as CodeLanguage,
      allowedLanguages: [],
      testCases: [],
    });
  });

  return { questions, errors };
}

export async function parseBankCodingWorkbook(
  buffer: Buffer,
): Promise<BankParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.worksheets[0];
  if (!sheet) {
    return {
      questions: [],
      errors: [
        { sheet: "Coding", row: 0, message: "The workbook has no sheets" },
      ],
    };
  }

  const h = headerIndex(sheet.getRow(1));
  const questions: ParsedBankQuestion[] = [];
  const errors: RowError[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const c = readBankCommon(row, h);
    const code = readCodingCore(row, h);
    if (!c.category && !c.text && !code.starterCode) return; // blank row

    if (!c.category) {
      errors.push({
        sheet: "Coding",
        row: rowNumber,
        message: "Missing category",
      });
      return;
    }
    if (!c.text) {
      errors.push({
        sheet: "Coding",
        row: rowNumber,
        message: "Missing question text",
      });
      return;
    }

    questions.push({
      ref: `row-${rowNumber}`,
      category: c.category,
      subCategory: c.subCategory,
      company: c.company,
      difficulty: c.difficulty,
      tags: c.tags,
      type: "CODE" as ExamQuestionTypeT,
      text: c.text,
      marks: c.marks,
      starterCode: code.starterCode,
      language: code.language,
      allowedLanguages: code.allowedLanguages,
      testCases: code.testCases,
    });
  });

  return { questions, errors };
}

// --- Import templates (generated FROM the column lists the parsers read) -----

/** MCQ bank sheet header — the exact names `parseBankMcqWorkbook` reads. */
export const BANK_MCQ_TEMPLATE_COLUMNS = [
  "category",
  "subCategory",
  "company",
  "difficulty",
  "tags",
  "text",
  "marks",
  "option1",
  "option2",
  "option3",
  "option4",
  "option5",
  "correctOptions",
] as const;

/** Coding bank sheet header — the exact names `parseBankCodingWorkbook` reads. */
export const BANK_CODING_TEMPLATE_COLUMNS = [
  "category",
  "subCategory",
  "company",
  "difficulty",
  "tags",
  "text",
  "marks",
  "starterCode",
  "language",
  "allowedLanguages",
  "input1",
  "expected1",
  "hidden1",
  "input2",
  "expected2",
  "hidden2",
  "input3",
  "expected3",
  "hidden3",
  "input4",
  "expected4",
  "hidden4",
  "input5",
  "expected5",
  "hidden5",
] as const;

export async function buildBankMcqTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  const ws = wb.addWorksheet("Bank MCQ");
  ws.addRow([...BANK_MCQ_TEMPLATE_COLUMNS]);
  ws.addRow([
    "Aptitude",
    "Arithmetic",
    "General",
    "easy",
    "math,basics",
    "What is 2 + 2?",
    5,
    "3",
    "4",
    "5",
    "6",
    "",
    "2",
  ]);
  ws.addRow([
    "Data Structures",
    "Complexity",
    "Acme",
    "medium",
    "big-o",
    "Which of these are O(n log n) sorts?",
    5,
    "Merge sort",
    "Bubble sort",
    "Heap sort",
    "Insertion sort",
    "",
    "1,3",
  ]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export async function buildBankCodingTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  const ws = wb.addWorksheet("Bank Coding");
  ws.addRow([...BANK_CODING_TEMPLATE_COLUMNS]);
  ws.addRow([
    "Coding",
    "Warmup",
    "General",
    "easy",
    "io,basics",
    "Read two integers and print their sum.",
    10,
    "# read two ints from stdin and print their sum\n",
    "python",
    "python",
    "2 3",
    "5",
    "false",
    "10 20",
    "30",
    "true",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Dispatch to the MCQ or coding bank template + its download filename. */
export async function buildBankTemplate(
  kind: ExamBulkUploadKind,
): Promise<{ buffer: Buffer; filename: string }> {
  return kind === "mcq"
    ? {
        buffer: await buildBankMcqTemplateWorkbook(),
        filename: "bank-mcq-template.xlsx",
      }
    : {
        buffer: await buildBankCodingTemplateWorkbook(),
        filename: "bank-coding-template.xlsx",
      };
}
