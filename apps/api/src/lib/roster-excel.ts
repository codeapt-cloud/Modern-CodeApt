/**
 * Excel parsing for the bulk-enroll roster (pure string extraction). Maps the
 * (lowercased/stripped) header to columns and returns one RawRosterRow per
 * non-blank data row; provisioning + enrollment happen in the service (reusing
 * the real auth machinery). Data lives on a "Roster" sheet, or the first sheet.
 *
 * Accepted columns: username | email | full_name | college_name
 *   | roll_number | phone_number | state | bio
 */
import ExcelJS from "exceljs";

export interface RawRosterRow {
  rowNumber: number;
  username: string;
  email: string;
  fullName: string;
  collegeName: string;
  rollNumber: string;
  phoneNumber: string;
  state: string;
  bio: string;
}

export interface RosterRowError {
  row: number;
  message: string;
}

export interface RosterParseResult {
  rows: RawRosterRow[];
  errors: RosterRowError[];
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

/** Header row for the "Roster" sheet — the exact names the parser reads. */
export const ROSTER_TEMPLATE_COLUMNS = [
  "username",
  "email",
  "full_name",
  "college_name",
  "roll_number",
  "phone_number",
  "state",
  "bio",
] as const;

/**
 * Build a ready-to-fill bulk-enroll roster workbook: a "Roster" sheet with one
 * example learner row. Provisioning + enrollment happen server-side from the
 * chosen subjects; this only carries the applicant details.
 */
export async function buildRosterTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  const ws = wb.addWorksheet("Roster");
  ws.addRow([...ROSTER_TEMPLATE_COLUMNS]);
  ws.addRow([
    "asha.rao",
    "asha@college.edu",
    "Asha Rao",
    "Acme Institute of Technology",
    "CS2026001",
    "9999999999",
    "KA",
    "Second-year CSE student.",
  ]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export async function parseRosterWorkbook(
  buffer: Buffer,
): Promise<RosterParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const sheet = wb.getWorksheet("Roster") ?? wb.worksheets[0];
  if (!sheet) {
    return {
      rows: [],
      errors: [{ row: 0, message: "The workbook has no sheets" }],
    };
  }

  const h = headerIndex(sheet.getRow(1));
  const rows: RawRosterRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const username = cellString(row, h.username);
    const email = cellString(row, h.email);
    const fullName = cellString(row, h.full_name);
    const collegeName = cellString(row, h.college_name);
    const rollNumber = cellString(row, h.roll_number);
    const phoneNumber = cellString(row, h.phone_number);
    const state = cellString(row, h.state);
    const bio = cellString(row, h.bio);

    // Skip fully blank rows silently.
    if (!username && !email && !fullName && !rollNumber) return;

    rows.push({
      rowNumber,
      username,
      email,
      fullName,
      collegeName,
      rollNumber,
      phoneNumber,
      state,
      bio,
    });
  });

  return { rows, errors: [] };
}
