/**
 * Small helpers for serving generated files as browser downloads — one place for
 * the Content-Type + Content-Disposition wiring so every "Download template"
 * endpoint is consistent (mirrors the student-import CSV controller). The web
 * client reads the filename back from the Content-Disposition header.
 */
import type { Response } from "express";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Send an .xlsx workbook buffer as an attachment download. */
export function sendXlsxAttachment(
  res: Response,
  buffer: Buffer,
  filename: string,
): void {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );
  res.status(200).send(buffer);
}
