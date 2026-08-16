/**
 * Excel tooling for exam authoring: parse a bulk-upload workbook into
 * sections/questions/test cases (with per-row validation), and build a results
 * export workbook. Uses ExcelJS (streaming-capable, pure JS, no native deps).
 *
 * Two SEPARATE single-sheet formats — one per question TYPE — so a non-technical
 * teacher never sees a half-blank row or a second sheet linked by a `ref`. Every
 * column on the sheet is one they must fill. Both read the FIRST worksheet (any
 * name), map headers by name with a positional fallback matching the template,
 * and find-or-create sections by name (section order = first-appearance order).
 *
 * MCQ sheet:
 *   section | sectionDuration | order | text | marks | option1..option5
 *     | correctOptions
 *   `correctOptions` is a comma-separated 1-BASED list; one answer → MCQ_SINGLE,
 *   several → MCQ_MULTI.
 * Coding sheet:
 *   section | sectionDuration | order | text | marks | starterCode | language
 *     | allowedLanguages | input1 | expected1 | hidden1 | … | input5 | expected5
 *     | hidden5
 *   Test cases are INLINE (up to 5). A test-case triple is imported when its
 *   input OR expected is non-empty; blank triples are skipped (1–5 per question).
 *   `hiddenN` truthy = true/1/yes/hidden. `allowedLanguages` is the CODE language
 *   policy: blank / "all" / "open" = OPEN (any language); a single language =
 *   LOCKED to it.
 */
import {
  CODE_LANGUAGE_VALUES,
  ExamQuestionType,
  type CodeLanguage,
  type ExamBulkUploadKind,
  type ExamQuestionType as ExamQuestionTypeT,
} from "@codeapt/shared";
import ExcelJS from "exceljs";

export interface ParsedTestCase {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
}
export interface ParsedQuestion {
  ref: string;
  sectionName: string;
  sectionOrder: number;
  sectionDuration: number;
  order: number;
  type: ExamQuestionTypeT;
  text: string;
  marks: number;
  options?: string[];
  correctOptions?: number[];
  starterCode: string;
  language: CodeLanguage;
  /** [] = open (any language), [lang] = locked. */
  allowedLanguages: CodeLanguage[];
  testCases: ParsedTestCase[];
}
export interface RowError {
  sheet: string;
  row: number;
  message: string;
}
export interface ParseResult {
  questions: ParsedQuestion[];
  errors: RowError[];
}

function cellString(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in v) return String(v.text);
  return String(v).trim();
}
function cellNumber(row: ExcelJS.Row, col: number): number | null {
  const v = row.getCell(col).value;
  if (typeof v === "number") return v;
  const n = Number(cellString(row, col));
  return Number.isFinite(n) ? n : null;
}

/** Map a header row to { columnName: index } (1-based). */
function headerIndex(row: ExcelJS.Row): Record<string, number> {
  const map: Record<string, number> = {};
  row.eachCell((cell, col) => {
    const name = String(cell.value ?? "").trim();
    if (name) map[name] = col;
  });
  return map;
}

/** Shared reader for the columns both sheets have in common (section + basics).
 * `sectionOrders` assigns each new section name its first-appearance order. */
function readCommon(
  row: ExcelJS.Row,
  h: Record<string, number>,
  sectionOrders: Map<string, number>,
): {
  sectionName: string;
  sectionOrder: number;
  sectionDuration: number;
  order: number;
  text: string;
  marks: number;
} {
  const sectionName = cellString(row, h.section ?? 1);
  let sectionOrder = sectionOrders.get(sectionName);
  if (sectionOrder === undefined) {
    sectionOrder = sectionOrders.size;
    sectionOrders.set(sectionName, sectionOrder);
  }
  return {
    sectionName,
    sectionOrder,
    sectionDuration: cellNumber(row, h.sectionDuration ?? 2) ?? 30,
    order: cellNumber(row, h.order ?? 3) ?? 0,
    text: cellString(row, h.text ?? 4),
    marks: cellNumber(row, h.marks ?? 5) ?? 5,
  };
}

// --- Shared question-field readers ------------------------------------------
//
// The TYPE-specific answer/test-case parsing (the drift-prone core) is factored
// out here so BOTH the exam importer (which wraps it with section columns) and
// the question-bank importer (which wraps it with bank-metadata columns) use the
// SAME logic — no duplication, and the exam importer's accepted format is
// unchanged. Keyed by header NAME; the positional fallbacks match the exam
// template (the bank template supplies the same header names, so the fallbacks
// are never hit there). Exported cell helpers let the bank parser read metadata.
export { cellString, cellNumber, headerIndex };

export type McqCore =
  | {
      ok: true;
      type: ExamQuestionTypeT;
      options: string[];
      correctOptions: number[];
    }
  | { ok: false; message: string };

/** Read the MCQ answer fields (option1..5 + correctOptions) and infer the type
 * (one answer → MCQ_SINGLE, several → MCQ_MULTI). `correctOptions` is a 1-BASED
 * comma list converted to 0-based indices. */
export function readMcqCore(
  row: ExcelJS.Row,
  h: Record<string, number>,
): McqCore {
  const options: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const opt = cellString(row, h[`option${i}`] ?? 5 + i);
    if (opt) options.push(opt);
  }
  const correctOptions = cellString(row, h.correctOptions ?? 11)
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n))
    .map((n) => n - 1) // 1-based → 0-based
    .filter((n) => n >= 0 && n < options.length);

  if (options.length < 2) {
    return { ok: false, message: "MCQ needs at least 2 options" };
  }
  if (correctOptions.length === 0) {
    return {
      ok: false,
      message: "MCQ needs at least 1 valid correctOption (1-based)",
    };
  }
  return {
    ok: true,
    type:
      correctOptions.length > 1
        ? ExamQuestionType.MCQ_MULTI
        : ExamQuestionType.MCQ_SINGLE,
    options,
    correctOptions,
  };
}

/** Read the CODE fields: starterCode, language, the language policy, and the up
 * to 5 INLINE test cases (a triple is kept when its input OR expected is set). */
export function readCodingCore(
  row: ExcelJS.Row,
  h: Record<string, number>,
): {
  starterCode: string;
  language: CodeLanguage;
  allowedLanguages: CodeLanguage[];
  testCases: ParsedTestCase[];
} {
  const testCases: ParsedTestCase[] = [];
  for (let i = 1; i <= 5; i++) {
    const base = 6 + (i - 1) * 3; // input_i fallback col (9,12,15,18,21)
    const input = cellString(row, h[`input${i}`] ?? base + 3);
    const expected = cellString(row, h[`expected${i}`] ?? base + 4);
    const hiddenRaw = cellString(row, h[`hidden${i}`] ?? base + 5);
    if (!input && !expected) continue; // skip empty triple
    testCases.push({
      input,
      expectedOutput: expected,
      isHidden: /^(true|1|yes|hidden)$/i.test(hiddenRaw),
    });
  }
  return {
    starterCode: cellString(row, h.starterCode ?? 6),
    language: normalizeLanguage(cellString(row, h.language ?? 7)),
    allowedLanguages: parseLanguagePolicy(
      cellString(row, h.allowedLanguages ?? 8),
    ),
    testCases,
  };
}

/**
 * Parse the MCQ workbook (first sheet). Every row is a complete MCQ; the answer
 * count decides single vs multi. `correctOptions` is a 1-BASED comma list,
 * converted to 0-based indices.
 */
export async function parseMcqWorkbook(buffer: Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS bundles an older non-generic `Buffer` type than @types/node's
  // generic one; the value is a real Node Buffer, safe at runtime.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.worksheets[0];
  if (!sheet) {
    return {
      questions: [],
      errors: [{ sheet: "MCQ", row: 0, message: "The workbook has no sheets" }],
    };
  }

  const h = headerIndex(sheet.getRow(1));
  const sectionOrders = new Map<string, number>();
  const questions: ParsedQuestion[] = [];
  const errors: RowError[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const c = readCommon(row, h, sectionOrders);
    // Skip fully blank rows silently.
    const hasAny =
      c.sectionName ||
      c.text ||
      cellString(row, h.option1 ?? 6) ||
      cellString(row, h.option2 ?? 7);
    if (!hasAny) return;

    if (!c.sectionName) {
      errors.push({ sheet: "MCQ", row: rowNumber, message: "Missing section" });
      return;
    }
    if (!c.text) {
      errors.push({ sheet: "MCQ", row: rowNumber, message: "Missing question text" });
      return;
    }

    const mcq = readMcqCore(row, h);
    if (!mcq.ok) {
      errors.push({ sheet: "MCQ", row: rowNumber, message: mcq.message });
      return;
    }

    questions.push({
      ref: `row-${rowNumber}`,
      sectionName: c.sectionName,
      sectionOrder: c.sectionOrder,
      sectionDuration: c.sectionDuration,
      order: c.order,
      type: mcq.type,
      text: c.text,
      marks: c.marks,
      options: mcq.options,
      correctOptions: mcq.correctOptions,
      starterCode: "",
      language: normalizeLanguage(""),
      allowedLanguages: [],
      testCases: [],
    });
  });

  return { questions, errors };
}

/**
 * Parse the coding workbook (first sheet). Every row is a complete CODE question
 * with its test cases INLINE (up to 5). A test-case triple is imported when its
 * input OR expected is non-empty; blank triples are skipped.
 */
export async function parseCodingWorkbook(
  buffer: Buffer,
): Promise<ParseResult> {
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
  const sectionOrders = new Map<string, number>();
  const questions: ParsedQuestion[] = [];
  const errors: RowError[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const c = readCommon(row, h, sectionOrders);
    const code = readCodingCore(row, h);
    if (!c.sectionName && !c.text && !code.starterCode) return; // blank row

    if (!c.sectionName) {
      errors.push({ sheet: "Coding", row: rowNumber, message: "Missing section" });
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
      sectionName: c.sectionName,
      sectionOrder: c.sectionOrder,
      sectionDuration: c.sectionDuration,
      order: c.order,
      type: ExamQuestionType.CODE,
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

// --- Import templates --------------------------------------------------------
//
// Each template is generated FROM the same column list its parser reads, so the
// two can NEVER drift. Round-trip drift-guard tests (tests/import-templates.test)
// generate each workbook and parse it back to prove it imports cleanly.

/** MCQ sheet header — the exact names `parseMcqWorkbook` reads (in order). */
export const MCQ_TEMPLATE_COLUMNS = [
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
] as const;

/** Coding sheet header — the exact names `parseCodingWorkbook` reads (in order),
 * including the 5 INLINE test-case triples. */
export const CODING_TEMPLATE_COLUMNS = [
  "section",
  "sectionDuration",
  "order",
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

/**
 * Build the MCQ template — one flat "MCQ Questions" sheet with worked examples
 * (a single-answer and a two-answer MCQ). `correctOptions` is 1-BASED; use a
 * comma list for multi-answer.
 */
export async function buildMcqTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  const ws = wb.addWorksheet("MCQ Questions");
  ws.addRow([...MCQ_TEMPLATE_COLUMNS]);
  // Single-answer: correctOptions "2" → option2 ("4") is correct.
  ws.addRow([
    "Aptitude",
    30,
    1,
    "What is 2 + 2?",
    5,
    "3",
    "4",
    "5",
    "6",
    "",
    "2",
  ]);
  // Multi-answer: correctOptions "1,3" → option1 and option3 are both correct.
  ws.addRow([
    "Aptitude",
    30,
    2,
    "Which of these are prime numbers?",
    5,
    "2",
    "4",
    "7",
    "9",
    "",
    "1,3",
  ]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * Build the coding template — one flat "Coding Questions" sheet with a worked
 * example: a question with two INLINE test cases (the second hidden). Leave a
 * test-case triple blank to use fewer than 5.
 */
export async function buildCodingTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  const ws = wb.addWorksheet("Coding Questions");
  ws.addRow([...CODING_TEMPLATE_COLUMNS]);
  ws.addRow([
    "Coding",
    45,
    1,
    "Read two integers and print their sum.",
    10,
    "# read two ints from stdin and print their sum\n",
    "python",
    "python", // allowedLanguages: a single language LOCKS to it; blank/all/open = any
    // test case 1 (visible)
    "2 3",
    "5",
    "false",
    // test case 2 (hidden)
    "10 20",
    "30",
    "true",
    // test cases 3-5 left blank (a question can have 1-5)
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

/** Dispatch to the MCQ or coding template + its download filename. */
export async function buildQuestionTemplate(
  kind: ExamBulkUploadKind,
): Promise<{ buffer: Buffer; filename: string }> {
  return kind === "mcq"
    ? { buffer: await buildMcqTemplateWorkbook(), filename: "mcq-questions-template.xlsx" }
    : {
        buffer: await buildCodingTemplateWorkbook(),
        filename: "coding-questions-template.xlsx",
      };
}

function normalizeLanguage(raw: string): CodeLanguage {
  const lower = raw.toLowerCase();
  return (CODE_LANGUAGE_VALUES as string[]).includes(lower)
    ? (lower as CodeLanguage)
    : ("python" as CodeLanguage);
}

/**
 * Parse the CODE language policy cell: blank / "all" / "open" (or an
 * unrecognized value) → OPEN ([]); a single supported language → LOCKED to it.
 */
function parseLanguagePolicy(raw: string): CodeLanguage[] {
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "all" || v === "open") return [];
  return (CODE_LANGUAGE_VALUES as string[]).includes(v)
    ? [v as CodeLanguage]
    : [];
}

// --- Results export ---------------------------------------------------------

export interface ResultRow {
  candidate: string;
  rollNumber: string;
  collegeName: string;
  /** Admin-only public-link session label (blank for logged-in takers). */
  tag: string;
  status: string;
  score: number;
  totalMarks: number;
  passed: boolean;
  autoSubmitted: boolean;
  warnings: number;
  sectionScores: { name: string; score: number }[];
  submittedAt: string;
}

export async function buildResultsWorkbook(
  examTitle: string,
  sectionNames: string[],
  rows: ResultRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  wb.subject = examTitle;
  const ws = wb.addWorksheet("Results");

  const columns: Partial<ExcelJS.Column>[] = [
    { header: "Candidate", key: "candidate", width: 24 },
    { header: "Roll Number", key: "rollNumber", width: 16 },
    { header: "College", key: "collegeName", width: 24 },
    { header: "Tag/Session", key: "tag", width: 22 },
    { header: "Status", key: "status", width: 12 },
    ...sectionNames.map((name, i) => ({
      header: name,
      key: `section${i}`,
      width: 14,
    })),
    { header: "Total", key: "score", width: 10 },
    { header: "Out Of", key: "totalMarks", width: 10 },
    { header: "Passed", key: "passed", width: 10 },
    { header: "Auto-Submitted", key: "autoSubmitted", width: 16 },
    { header: "Warnings", key: "warnings", width: 10 },
    { header: "Submitted At", key: "submittedAt", width: 24 },
  ];
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    const record: Record<string, string | number | boolean> = {
      candidate: r.candidate,
      rollNumber: r.rollNumber,
      collegeName: r.collegeName,
      tag: r.tag,
      status: r.status,
      score: r.score,
      totalMarks: r.totalMarks,
      passed: r.passed ? "PASS" : "FAIL",
      autoSubmitted: r.autoSubmitted ? "Yes" : "No",
      warnings: r.warnings,
      submittedAt: r.submittedAt,
    };
    sectionNames.forEach((name, i) => {
      record[`section${i}`] =
        r.sectionScores.find((s) => s.name === name)?.score ?? 0;
    });
    ws.addRow(record);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
