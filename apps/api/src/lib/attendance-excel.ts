/**
 * Excel tooling for the attendance ROLL-NUMBER upload (Prompt 1). Mirrors the
 * roster-excel idiom (ExcelJS load → header map → row iterate → string cells)
 * but only needs ONE column: `roll_number`. The parser returns the raw roll
 * numbers found; the SERVICE matches them against the college's students and
 * builds the matched/unmatched preview (nothing is created here).
 *
 * Accepted column: `roll_number` (case-insensitive). Falls back to the FIRST
 * column when no header matches, so a plain one-column list of rolls also works.
 */
import ExcelJS from "exceljs";

/** Header the parser reads (and the template writes) — single source of truth. */
export const ATTENDANCE_TEMPLATE_COLUMNS = ["roll_number"] as const;

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

/**
 * Build a ready-to-fill attendance roll-number workbook: a "Roll Numbers" sheet
 * with the single `roll_number` column + a couple of example rolls.
 */
export async function buildAttendanceTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  const ws = wb.addWorksheet("Roll Numbers");
  ws.addRow([...ATTENDANCE_TEMPLATE_COLUMNS]);
  ws.addRow(["CS2026001"]);
  ws.addRow(["CS2026002"]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * Parse a workbook into the list of roll numbers it contains (first sheet). Uses
 * the `roll_number` header when present, else the first column. Blank cells are
 * skipped; de-duplication + matching are the service's job.
 */
export async function parseAttendanceRollNumbers(
  buffer: Buffer,
): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.getWorksheet("Roll Numbers") ?? wb.worksheets[0];
  if (!sheet) return [];

  const h = headerIndex(sheet.getRow(1));
  const col = h.roll_number ?? 1; // header, else first column
  const hasHeader = h.roll_number !== undefined;

  const rolls: string[] = [];
  sheet.eachRow((row, rowNumber) => {
    // Skip the header row only when we actually matched a header name (a bare
    // one-column list without a header keeps its first row).
    if (rowNumber === 1 && hasHeader) return;
    const value = cellString(row, col);
    if (value) rolls.push(value);
  });
  return rolls;
}
