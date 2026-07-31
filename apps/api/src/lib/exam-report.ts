/**
 * Exam analysis Excel report (Phase 5) — ExcelJS workbook, mirroring the exam
 * results-export style (frozen bold header, widths, totals). Sheets:
 *  - Results: ranked students × [score, %, result, per-section scores], with a
 *    class-average footer + the topper.
 *  - Distribution: the score-band histogram (band → count).
 *  - Questions: per-question correct-rate (only when question data exists).
 *
 * Pure over the already-aggregated report data — presentation only.
 */
import ExcelJS from "exceljs";

import type { ExamReportData } from "../services/exam-analysis.service.js";

const HEADER_FONT = { bold: true } as const;
const FROZEN = [{ state: "frozen" as const, ySplit: 1 }];
const pct = (r: number | null): string => (r === null ? "—" : `${r}%`);

export async function buildExamAnalysisWorkbook(
  data: ExamReportData,
): Promise<Buffer> {
  const { analysis, sectionNames, rows } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  wb.subject = `Exam analysis — ${analysis.examTitle}`;

  // --- Results (ranked) ---
  const results = wb.addWorksheet("Results");
  results.addRow([
    "Rank",
    "Student",
    "Roll",
    "Score",
    "%",
    "Result",
    ...sectionNames,
  ]);
  results.getRow(1).font = HEADER_FONT;
  results.views = FROZEN;
  results.getColumn(2).width = 26;
  results.getColumn(3).width = 16;
  rows.forEach((r, i) => {
    results.addRow([
      i + 1,
      r.name,
      r.rollNumber,
      r.score,
      pct(r.percent),
      r.passed ? "PASS" : "FAIL",
      ...r.sectionScores,
    ]);
  });
  // Class-average footer (over graded attempts).
  results.addRow([]);
  results.addRow([
    "",
    "Class average",
    "",
    analysis.overview.avgScore ?? "—",
    pct(analysis.overview.avgPercent),
    `pass ${pct(analysis.overview.passRate)}`,
  ]);
  results.addRow([
    "",
    "Highest / Lowest / Median",
    "",
    analysis.overview.highest ?? "—",
    analysis.overview.lowest ?? "—",
    analysis.overview.median ?? "—",
  ]);
  results.getRow(results.rowCount).font = HEADER_FONT;
  results.getRow(results.rowCount - 1).font = HEADER_FONT;

  // --- Distribution (histogram) ---
  const dist = wb.addWorksheet("Distribution");
  dist.addRow(["Band (%)", "Students"]);
  dist.getRow(1).font = HEADER_FONT;
  dist.views = FROZEN;
  dist.getColumn(1).width = 14;
  for (const b of analysis.distribution) {
    dist.addRow([b.label, b.count]);
  }

  // --- Questions (only when per-question data exists) ---
  if (analysis.hasQuestionData) {
    const q = wb.addWorksheet("Questions");
    q.addRow(["#", "Section", "Question", "Max", "Correct", "Attempts", "% correct"]);
    q.getRow(1).font = HEADER_FONT;
    q.views = FROZEN;
    q.getColumn(2).width = 18;
    q.getColumn(3).width = 50;
    analysis.questions.forEach((qs, i) => {
      q.addRow([
        i + 1,
        qs.section,
        qs.text,
        qs.maxMarks,
        qs.correct,
        qs.total,
        pct(qs.correctRate),
      ]);
    });
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
