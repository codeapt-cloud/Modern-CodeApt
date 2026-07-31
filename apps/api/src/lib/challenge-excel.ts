/**
 * Excel parsing for bulk daily-challenge import. Pure string extraction (mirrors
 * `topic-excel.ts`): it maps the (lowercased/stripped) header to columns and
 * returns one RawChallengeRow per non-blank data row, carrying `rowNumber` so
 * the service can attribute per-row errors. Date assignment, type resolution,
 * validation, conflict detection and creation all live in the service (so the
 * interactive `createChallenge` logic is reused verbatim).
 *
 * Accepted columns:
 *   type (mcq/code) | date (YYYY-MM-DD) | title | description | marks
 *   MCQ:  options (pipe/newline-separated) | correct (1-based index)
 *   CODE: starter_code (or starter) | language
 *         | cases (test cases, "input=>expected" per line; prefix "*" = hidden)
 * The data lives on a "Challenges" sheet, or the first sheet if none is named.
 */
import ExcelJS from "exceljs";

export interface RawChallengeRow {
  rowNumber: number;
  type: string;
  date: string;
  title: string;
  description: string;
  marks: string;
  options: string;
  correct: string;
  starterCode: string;
  language: string;
  cases: string;
}

export interface ChallengeRowError {
  row: number;
  message: string;
}

export interface ChallengeParseResult {
  rows: RawChallengeRow[];
  errors: ChallengeRowError[];
}

function cellString(row: ExcelJS.Row, col: number | undefined): string {
  if (!col) return "";
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in v) return String(v.text).trim();
  if (typeof v === "object" && "result" in v) {
    return String((v as { result?: unknown }).result ?? "").trim();
  }
  return String(v).trim();
}

/** Map the header row to { normalisedColumnName: index } (1-based). */
function headerIndex(row: ExcelJS.Row): Record<string, number> {
  const map: Record<string, number> = {};
  row.eachCell((cell, col) => {
    const name = String(cell.value ?? "")
      .trim()
      .toLowerCase();
    if (name) map[name] = col;
  });
  return map;
}

// --- Import template ---------------------------------------------------------

/** Header row for the "Challenges" sheet — the exact names the parser reads
 * (lower-case; the parser lower-cases headers on read). */
export const CHALLENGE_TEMPLATE_COLUMNS = [
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
] as const;

/**
 * Build a ready-to-fill daily-challenge workbook: a "Challenges" sheet with one
 * MCQ and one CODE example. `date` may be blank (the importer assigns from the
 * chosen start date); `options` are newline/pipe-separated with a 1-based
 * `correct`; `cases` are "input=>expected" per line ("*" prefix = hidden).
 */
export async function buildChallengeTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  const ws = wb.addWorksheet("Challenges");
  ws.addRow([...CHALLENGE_TEMPLATE_COLUMNS]);
  ws.addRow([
    "mcq",
    "",
    "Time complexity of binary search",
    "Pick the tightest bound.",
    5,
    "O(n)\nO(log n)\nO(n log n)\nO(1)",
    "2",
    "",
    "",
    "",
  ]);
  ws.addRow([
    "code",
    "",
    "Sum of two integers",
    "Read two integers and print their sum.",
    10,
    "",
    "",
    "# read two ints from stdin and print their sum\n",
    "python",
    "2 3=>5\n*10 20=>30",
  ]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export async function parseChallengeWorkbook(
  buffer: Buffer,
): Promise<ChallengeParseResult> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS bundles an older non-generic Buffer type than @types/node's; the
  // value is a real Node Buffer, safe at runtime.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const sheet = wb.getWorksheet("Challenges") ?? wb.worksheets[0];
  if (!sheet) {
    return {
      rows: [],
      errors: [{ row: 0, message: "The workbook has no sheets" }],
    };
  }

  const h = headerIndex(sheet.getRow(1));
  const starterCol = h.starter_code ?? h.starter;

  const rows: RawChallengeRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const type = cellString(row, h.type);
    const date = cellString(row, h.date);
    const title = cellString(row, h.title);
    const description = cellString(row, h.description);
    const marks = cellString(row, h.marks);
    const options = cellString(row, h.options);
    const correct = cellString(row, h.correct);
    const starterCode = cellString(row, starterCol);
    const language = cellString(row, h.language);
    const cases = cellString(row, h.cases);

    // Skip fully blank rows silently.
    if (!type && !date && !title && !description && !options && !cases) return;

    rows.push({
      rowNumber,
      type,
      date,
      title,
      description,
      marks,
      options,
      correct,
      starterCode,
      language,
      cases,
    });
  });

  return { rows, errors: [] };
}
