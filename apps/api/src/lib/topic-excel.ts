/**
 * Excel parsing for bulk topic import (text/video only — mirrors the original
 * Django per-subject importer's scope). Pure string extraction: it maps the
 * (lowercased/stripped) header to columns and returns one RawTopicRow per
 * non-blank data row. Type resolution, YouTube-id extraction, module
 * get-or-create, per-row validation and topic creation all happen in the
 * service (so the interactive createTopic logic is reused verbatim).
 *
 * Accepted columns: module | name (or title) | type | content
 *   | video_id (or video_url) | duration | order
 * The data lives on a "Topics" sheet, or the first sheet if none is named that.
 */
import ExcelJS from "exceljs";

export interface RawTopicRow {
  rowNumber: number;
  module: string;
  name: string;
  type: string;
  content: string;
  video: string; // from video_id or video_url
  duration: string;
  order: string;
}

export interface TopicRowError {
  row: number;
  message: string;
}

export interface TopicParseResult {
  rows: RawTopicRow[];
  errors: TopicRowError[];
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

/** Map the header row to { normalisedColumnName: index } (1-based). */
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

/** Header row for the "Topics" sheet — the exact names the parser reads
 * (lower-case; `name`/`video_id` are the canonical forms of the accepted
 * `name|title` / `video_id|video_url` aliases). */
export const TOPIC_TEMPLATE_COLUMNS = [
  "module",
  "name",
  "type",
  "content",
  "video_id",
  "duration",
  "order",
] as const;

/**
 * Build a ready-to-fill topics workbook: a "Topics" sheet with one text topic
 * and one video topic. `module` is get-or-created by name; `video_id` accepts a
 * YouTube id or URL (the service extracts the id).
 */
export async function buildTopicTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  const ws = wb.addWorksheet("Topics");
  ws.addRow([...TOPIC_TEMPLATE_COLUMNS]);
  ws.addRow([
    "Getting Started",
    "Welcome & setup",
    "text",
    "# Welcome\nInstall the tools and read the syllabus.",
    "",
    10,
    1,
  ]);
  ws.addRow([
    "Getting Started",
    "Intro video",
    "video",
    "",
    "dQw4w9WgXcQ",
    8,
    2,
  ]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export async function parseTopicWorkbook(
  buffer: Buffer,
): Promise<TopicParseResult> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS bundles an older non-generic Buffer type than @types/node's; the
  // value is a real Node Buffer, safe at runtime.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const sheet = wb.getWorksheet("Topics") ?? wb.worksheets[0];
  if (!sheet) {
    return {
      rows: [],
      errors: [{ row: 0, message: "The workbook has no sheets" }],
    };
  }

  const h = headerIndex(sheet.getRow(1));
  const nameCol = h.name ?? h.title;
  const videoCol = h.video_id ?? h.video_url;

  const rows: RawTopicRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const moduleName = cellString(row, h.module);
    const name = cellString(row, nameCol);
    const type = cellString(row, h.type);
    const content = cellString(row, h.content);
    const video = cellString(row, videoCol);
    const duration = cellString(row, h.duration);
    const order = cellString(row, h.order);

    // Skip fully blank rows silently.
    if (!moduleName && !name && !type && !content && !video) return;

    rows.push({
      rowNumber,
      module: moduleName,
      name,
      type,
      content,
      video,
      duration,
      order,
    });
  });

  return { rows, errors: [] };
}
