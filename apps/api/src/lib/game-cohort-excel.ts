/**
 * Gaming cohort export (Step 24 G2) — ExcelJS workbook mirroring the
 * communication-cohort-excel conventions (frozen bold header, fixed widths). ONE
 * sheet: one row per cohort student, a column per AUTHORED game (the TRUE raw
 * per-game score — UNCLAMPED, so a negative grid_challenge score survives), then
 * the composite, attempt count, and status.
 *
 * Honesty carried over verbatim from the communication export: a student who
 * never attempted shows "—" per game and "—" composite (never a fabricated 0); an
 * in-progress attempt reads "in progress", an abandoned one "abandoned" — neither
 * is dressed up as a low score.
 */
import {
  GameSetAttemptStatus,
  type GameCohortReport,
} from "@codeapt/shared";
import ExcelJS from "exceljs";

const HEADER_FONT = { bold: true } as const;
const FROZEN = [{ state: "frozen" as const, ySplit: 1 }];

const STATUS_LABEL: Record<GameSetAttemptStatus, string> = {
  [GameSetAttemptStatus.IN_PROGRESS]: "in progress",
  [GameSetAttemptStatus.GRADED]: "graded",
  [GameSetAttemptStatus.ABANDONED]: "abandoned",
};

/** A per-game raw cell: the number when played, "—" otherwise (never a fake 0). */
const raw = (v: number | null, played: boolean): number | string =>
  played && v !== null ? v : "—";

export async function buildGameCohortWorkbook(
  report: GameCohortReport,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  wb.subject = `Gaming cohort — ${report.title}`;

  const ws = wb.addWorksheet("Cohort");

  const header: string[] = ["Roll", "Student"];
  for (const g of report.games) {
    header.push(`${g.gameKey} (game ${g.gameIndex + 1})`);
  }
  header.push("Composite", "Attempts", "Status");
  ws.addRow(header);
  ws.getRow(1).font = HEADER_FONT;
  ws.views = FROZEN;

  for (const row of report.rows) {
    const cells: (string | number)[] = [row.rollNumber, row.userName];
    const byGame = new Map(row.cells.map((c) => [c.gameIndex, c]));
    for (const g of report.games) {
      const c = byGame.get(g.gameIndex);
      cells.push(c ? raw(c.rawScore, c.played) : "—");
    }
    cells.push(
      row.compositeScore === null ? "—" : row.compositeScore,
      row.attemptCount,
      row.status === null ? "—" : STATUS_LABEL[row.status],
    );
    ws.addRow(cells);
  }

  ws.columns.forEach((col) => {
    col.width = 16;
  });
  ws.getColumn(2).width = 26;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
