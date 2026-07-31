/**
 * Per-college student-performance export workbook (ExcelJS). Mirrors the exam
 * results export (`buildResultsWorkbook`): a single "Performance" sheet with a
 * bold header row, one row per student, sorted by college then name.
 *
 * Columns are driven ONLY by data the rebuild actually stores — enrollments,
 * exam attempts (taken/passed/avg %), essay attempts (count/avg score), daily
 * streak/score, topics completed. Nothing here is fabricated; a metric the data
 * can't support is simply not a column.
 */
import ExcelJS from "exceljs";

export interface CollegePerformanceRow {
  college: string;
  student: string;
  rollNumber: string;
  email: string;
  enrollments: number;
  examsTaken: number;
  examsPassed: number;
  avgExamPercent: number;
  essaysSubmitted: number;
  avgEssayScore: number;
  currentStreak: number;
  maxStreak: number;
  dailyTotalScore: number;
  topicsCompleted: number;
  joinedAt: string;
}

export async function buildCollegePerformanceWorkbook(
  rows: CollegePerformanceRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  wb.subject = "Per-college student performance";
  const ws = wb.addWorksheet("Performance");

  ws.columns = [
    { header: "College", key: "college", width: 28 },
    { header: "Student", key: "student", width: 24 },
    { header: "Roll Number", key: "rollNumber", width: 16 },
    { header: "Email", key: "email", width: 26 },
    { header: "Enrollments", key: "enrollments", width: 13 },
    { header: "Exams Taken", key: "examsTaken", width: 13 },
    { header: "Exams Passed", key: "examsPassed", width: 14 },
    { header: "Avg Exam %", key: "avgExamPercent", width: 12 },
    { header: "Essays Submitted", key: "essaysSubmitted", width: 16 },
    { header: "Avg Essay Score", key: "avgEssayScore", width: 15 },
    { header: "Current Streak", key: "currentStreak", width: 14 },
    { header: "Best Streak", key: "maxStreak", width: 12 },
    { header: "Daily Score", key: "dailyTotalScore", width: 12 },
    { header: "Topics Completed", key: "topicsCompleted", width: 16 },
    { header: "Joined", key: "joinedAt", width: 22 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of rows) ws.addRow(r);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
