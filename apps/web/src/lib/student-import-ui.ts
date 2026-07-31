/**
 * Pure (React/DOM-free) client-side parser for the student bulk-import UI. Turns
 * a file's text OR a pasted table into StudentImportRowInput[] — the SAME shape
 * the 3a backend's preview/commit consume — so the file and paste paths feed one
 * pipeline. Header-aware (maps fullName/email/rollNumber/orgUnit columns in any
 * order, tolerant of spaces/underscores/case) and falls back to positional order
 * when there's no recognizable header. Handles CSV and TSV (spreadsheet paste),
 * quoted fields, ragged rows, and blank lines. Unit-tested in isolation.
 *
 * Field VALIDATION (required fields, email shape, dup/scope) is NOT done here —
 * that's the backend's shared validateStudentImportRow + the preview pipeline.
 * This only structures raw text into rows.
 */
import { STUDENT_IMPORT_HEADERS, type StudentImportRowInput } from "@codeapt/shared";

export interface ParsedStudentRows {
  rows: StudentImportRowInput[];
  /** True when the first line was detected + consumed as a header. */
  hadHeader: boolean;
  /** The delimiter used (tab for spreadsheet paste, comma for CSV). */
  delimiter: "," | "\t";
}

/** Canonical form of a header cell: lowercased, spaces/underscores stripped. */
function normalizeHeader(cell: string): string {
  return cell.toLowerCase().replace(/[\s_]+/g, "");
}

const HEADER_KEYS = STUDENT_IMPORT_HEADERS.map(normalizeHeader); // fullname,email,rollnumber,orgunit

/** Split one line into cells for the given delimiter, honoring "..." quoting. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1; // escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/**
 * Parse pasted/file text into import rows. Returns an empty result for
 * blank input. Rows where every mapped field is empty are dropped.
 */
export function parseStudentRows(text: string): ParsedStudentRows {
  const lines = text
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { rows: [], hadHeader: false, delimiter: "," };
  }

  // Delimiter: spreadsheet paste uses tabs; CSV uses commas.
  const first = lines[0] ?? "";
  const delimiter: "," | "\t" = first.includes("\t") ? "\t" : ",";

  const table = lines.map((l) => splitLine(l, delimiter));

  // Header detection: the first row is a header if ≥2 of its cells match known
  // header names. Otherwise assume positional order (fullName,email,rollNumber,
  // orgUnit).
  const headerCells = (table[0] ?? []).map(normalizeHeader);
  const matches = headerCells.filter((c) => HEADER_KEYS.includes(c)).length;
  const hadHeader = matches >= 2;

  // Column index for each field.
  const colOf: Record<keyof StudentImportRowInput, number> = hadHeader
    ? {
        fullName: headerCells.indexOf("fullname"),
        email: headerCells.indexOf("email"),
        rollNumber: headerCells.indexOf("rollnumber"),
        orgUnit: headerCells.indexOf("orgunit"),
      }
    : { fullName: 0, email: 1, rollNumber: 2, orgUnit: 3 };

  const dataRows = hadHeader ? table.slice(1) : table;

  const cell = (cells: string[], idx: number): string =>
    idx >= 0 && idx < cells.length ? (cells[idx] ?? "") : "";

  const rows: StudentImportRowInput[] = [];
  for (const cells of dataRows) {
    const row: StudentImportRowInput = {
      fullName: cell(cells, colOf.fullName),
      email: cell(cells, colOf.email),
      rollNumber: cell(cells, colOf.rollNumber),
      orgUnit: cell(cells, colOf.orgUnit),
    };
    if (row.fullName || row.email || row.rollNumber || row.orgUnit) {
      rows.push(row);
    }
  }

  return { rows, hadHeader, delimiter };
}
