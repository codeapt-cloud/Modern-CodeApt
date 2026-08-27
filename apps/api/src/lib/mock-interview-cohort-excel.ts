/**
 * AI Mock Interview cohort export (Step 33) — ExcelJS workbook in the same
 * frozen-bold-header style as the communication/exam exporters. One row per
 * student: the BEST attempt's overall + the five dimensions + its score source.
 *
 * Honesty: an unscored / AI-absent dimension shows "—" (never a fake 0); the
 * `source` column makes visible whether the score used AI judgement or the
 * deterministic floor alone.
 */
import type { MockInterviewCohortReport } from "@codeapt/shared";
import ExcelJS from "exceljs";

const HEADER_FONT = { bold: true } as const;
const FROZEN = [{ state: "frozen" as const, ySplit: 1 }];
const cell = (v: number | null): number | string => (v === null ? "—" : v);

export async function buildMockInterviewCohortWorkbook(
  report: MockInterviewCohortReport,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  wb.subject = `Mock interview — ${report.title}`;

  const ws = wb.addWorksheet("Interview");
  ws.addRow([
    "Roll",
    "Student",
    "Attempts",
    "Best overall (%)",
    "Speaking",
    "Vocabulary",
    "Concept",
    "Analysis",
    "Topic knowledge",
    "Score source",
  ]);
  ws.getRow(1).font = HEADER_FONT;
  ws.views = FROZEN;

  for (const r of report.rows) {
    ws.addRow([
      r.rollNumber,
      r.userName,
      r.attempts,
      cell(r.bestOverall),
      cell(r.speaking),
      cell(r.vocabulary),
      cell(r.concept),
      cell(r.analysis),
      cell(r.topicKnowledge),
      r.source ?? "—",
    ]);
  }

  ws.columns.forEach((col) => {
    col.width = 16;
  });
  ws.getColumn(2).width = 26;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
