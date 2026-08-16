/**
 * Builds the per-course enrollment roster export (admin "Manage enrollments" →
 * Download roster). One "Enrollments" sheet: who is enrolled, how, when, and
 * their access window. Pure over already-aggregated rows.
 */
import ExcelJS from "exceljs";

export interface EnrollmentRosterRow {
  fullName: string;
  email: string;
  rollNumber: string;
  source: string;
  enrolledAt: string;
  expiresAt: string | null;
  active: boolean;
}

export async function buildEnrollmentRosterWorkbook(
  courseTitle: string,
  rows: EnrollmentRosterRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  wb.subject = courseTitle;
  const ws = wb.addWorksheet("Enrollments");

  ws.columns = [
    { header: "Name", key: "fullName", width: 24 },
    { header: "Email", key: "email", width: 28 },
    { header: "Roll Number", key: "rollNumber", width: 16 },
    { header: "Source", key: "source", width: 12 },
    { header: "Enrolled At", key: "enrolledAt", width: 22 },
    { header: "Access Until", key: "expiresAt", width: 22 },
    { header: "Status", key: "status", width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of rows) {
    ws.addRow({
      fullName: r.fullName,
      email: r.email,
      rollNumber: r.rollNumber,
      source: r.source,
      enrolledAt: r.enrolledAt ? new Date(r.enrolledAt).toLocaleString() : "",
      expiresAt: r.expiresAt ? new Date(r.expiresAt).toLocaleString() : "Lifetime",
      status: r.active ? "Active" : "Expired",
    });
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
