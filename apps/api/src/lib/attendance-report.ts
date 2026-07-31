/**
 * Attendance Excel reports (Prompt 3) — ExcelJS workbook builders, mirroring the
 * exam results-export style (frozen bold header, column widths, totals). Two
 * reports:
 *  - REGISTER: the classic P/A grid for one group — students (rows) × completed
 *    sessions (dated columns), a P/A cell each, per-student total + %, and a
 *    per-session present total footer row.
 *  - SUMMARY: per-student % (worst first) + a defaulters sheet + a per-group
 *    rates sheet — the college-wide (or filtered) picture.
 *
 * Pure over the report data (no DB) — the service supplies already-aggregated
 * rows, so these builders stay presentation-only and unit-test by round-trip.
 */
import ExcelJS from "exceljs";

import type {
  RegisterReport,
  SummaryReport,
} from "../services/attendance-analytics.service.js";

const HEADER_FONT = { bold: true } as const;
const FROZEN_HEADER = [{ state: "frozen" as const, ySplit: 1 }];

function pct(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

/** Register grid: students × sessions, P/A cells, per-student + per-session totals. */
export async function buildRegisterWorkbook(
  data: RegisterReport,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  wb.subject = `Attendance register — ${data.groupName}`;
  const ws = wb.addWorksheet("Register");

  const header = [
    "Roll No",
    "Student",
    ...data.sessions.map((s) => s.label),
    "Present",
    "Total",
    "%",
  ];
  ws.addRow(header);
  ws.getRow(1).font = HEADER_FONT;
  ws.views = FROZEN_HEADER;

  // Column widths: name wide, session cells narrow.
  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 26;
  data.sessions.forEach((_s, i) => {
    ws.getColumn(3 + i).width = 12;
  });

  for (const row of data.rows) {
    ws.addRow([
      row.rollNumber,
      row.name,
      ...row.cells,
      row.present,
      row.total,
      pct(row.rate),
    ]);
  }

  // Footer: per-session present totals.
  const footer = ["", "Present / session", ...data.sessionPresent];
  ws.addRow(footer);
  ws.getRow(ws.rowCount).font = HEADER_FONT;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Summary: per-student %, a defaulters sheet, and per-group rates. */
export async function buildSummaryWorkbook(
  data: SummaryReport,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  wb.subject = "Attendance summary";

  // Sheet 1 — students (worst first).
  const students = wb.addWorksheet("Students");
  students.addRow(["Roll No", "Student", "Attended", "Total", "%", "Status"]);
  students.getRow(1).font = HEADER_FONT;
  students.views = FROZEN_HEADER;
  students.getColumn(1).width = 16;
  students.getColumn(2).width = 26;
  students.getColumn(6).width = 16;
  for (const s of data.students) {
    students.addRow([
      s.rollNumber,
      s.name,
      s.attended,
      s.total,
      pct(s.rate),
      s.total === 0 ? "No data" : s.below ? "Below threshold" : "OK",
    ]);
  }

  // Sheet 2 — defaulters (below the threshold).
  const defaulters = wb.addWorksheet(`Defaulters (< ${data.threshold}%)`);
  defaulters.addRow(["Roll No", "Student", "Attended", "Total", "%"]);
  defaulters.getRow(1).font = HEADER_FONT;
  defaulters.views = FROZEN_HEADER;
  defaulters.getColumn(1).width = 16;
  defaulters.getColumn(2).width = 26;
  if (data.defaulters.length === 0) {
    defaulters.addRow(["", "No students below the threshold", "", "", ""]);
  } else {
    for (const s of data.defaulters) {
      defaulters.addRow([s.rollNumber, s.name, s.attended, s.total, pct(s.rate)]);
    }
  }

  // Sheet 3 — per-group rates.
  const groups = wb.addWorksheet("Groups");
  groups.addRow(["Group", "Kind", "Members", "Sessions held", "%"]);
  groups.getRow(1).font = HEADER_FONT;
  groups.views = FROZEN_HEADER;
  groups.getColumn(1).width = 26;
  for (const g of data.groups) {
    groups.addRow([g.name, g.kind, g.memberCount, g.sessionsHeld, pct(g.rate)]);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
