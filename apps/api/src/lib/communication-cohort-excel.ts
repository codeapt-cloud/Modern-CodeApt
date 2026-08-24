/**
 * Communication composite cohort export (Step 21) — ExcelJS workbook mirroring
 * the exam-analysis / coding-leaderboard style (frozen bold header, widths). The
 * ONE export that replaces the four manual joins operators do today: one row per
 * student, columns for EACH part (percent + band) followed by the composite.
 *
 * Honesty in the sheet: a part a student hasn't scored shows "—" (never a fake
 * 0) with its status; an incomplete composite shows "— (partial)" and its
 * scored/total progress, never a low number that reads as a real fail.
 */
import type { CommunicationCohortReport } from "@codeapt/shared";
import ExcelJS from "exceljs";

const HEADER_FONT = { bold: true } as const;
const FROZEN = [{ state: "frozen" as const, ySplit: 1 }];

const pct = (v: number | null): number | string => (v === null ? "—" : v);
const band = (v: string | null): string => (v === null ? "—" : v);

export async function buildCommunicationCohortWorkbook(
  report: CommunicationCohortReport,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  wb.subject = `Communication composite — ${report.title}`;

  const ws = wb.addWorksheet("Composite");

  const header: string[] = ["Roll", "Student"];
  for (const p of report.parts) {
    header.push(`${p.label} (%)`, `${p.label} band`);
  }
  header.push("Composite (%)", "Composite band", "Progress");
  ws.addRow(header);
  ws.getRow(1).font = HEADER_FONT;
  ws.views = FROZEN;

  for (const row of report.rows) {
    const cells: (string | number)[] = [row.rollNumber, row.userName];
    // Cells are ordered to match report.parts by `order`.
    const byOrder = new Map(row.cells.map((c) => [c.order, c]));
    for (const p of report.parts) {
      const c = byOrder.get(p.order);
      if (!c) {
        cells.push("—", "—");
      } else {
        // Show the BEST score, but annotate when more than one attempt was made
        // so the operator sees a retake happened (a later attempt may have been
        // worse). Numeric when there's nothing to annotate — keeps the column
        // sortable — matching the "(partial)" composite annotation below.
        const scoreCell =
          c.percent !== null && c.attemptCount > 1
            ? `${c.percent} (best of ${c.attemptCount})`
            : pct(c.percent);
        cells.push(scoreCell, band(c.band));
      }
    }
    const comp = row.composite;
    cells.push(
      comp.compositePercent === null
        ? comp.partial
          ? "— (partial)"
          : "—"
        : comp.partial
          ? `${comp.compositePercent} (partial)`
          : comp.compositePercent,
      band(comp.band),
      `${comp.scoredCount}/${comp.totalCount}`,
    );
    ws.addRow(cells);
  }

  ws.columns.forEach((col) => {
    col.width = 18;
  });
  ws.getColumn(2).width = 26;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
