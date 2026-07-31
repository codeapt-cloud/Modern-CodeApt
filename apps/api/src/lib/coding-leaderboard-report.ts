/**
 * Coding leaderboard Excel report (Prompt 2) — ExcelJS workbook mirroring the
 * exam-analysis export style (frozen bold header, widths, a counts footer).
 * Pure over the already-ranked leaderboard response — presentation only, honors
 * whatever filters produced the response. Ranked rows keep their rank; unranked
 * (na/stale) rows show "—" for rank + metric, so the sheet is honest too.
 */
import {
  CodingPlatform,
  type CodingLeaderboardResponse,
  type CodingLeaderboardRow,
  type CodingMetric,
} from "@codeapt/shared";
import ExcelJS from "exceljs";

const HEADER_FONT = { bold: true } as const;
const FROZEN = [{ state: "frozen" as const, ySplit: 1 }];

const PLATFORM_LABEL: Record<CodingPlatform, string> = {
  [CodingPlatform.CODEFORCES]: "Codeforces",
  [CodingPlatform.LEETCODE]: "LeetCode",
  [CodingPlatform.CODECHEF]: "CodeChef",
};
const METRIC_LABEL: Record<CodingMetric, string> = {
  rating: "Rating",
  problemsSolved: "Solved",
};

const dash = (v: number | null): number | string => (v === null ? "—" : v);

function statValue(
  row: CodingLeaderboardRow,
  platform: CodingPlatform,
  field: "rating" | "problemsSolved",
): number | string {
  const s = row.stats.find((x) => x.platform === platform);
  return s ? dash(s[field]) : "—";
}

export async function buildCodingLeaderboardWorkbook(
  data: CodingLeaderboardResponse,
): Promise<Buffer> {
  const { overview, rows } = data;
  const rankedMetricCol = `${PLATFORM_LABEL[overview.platform]} ${METRIC_LABEL[overview.metric]}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = "CodeApt";
  wb.subject = `Coding leaderboard — ${PLATFORM_LABEL[overview.platform]} by ${METRIC_LABEL[overview.metric]}`;

  const ws = wb.addWorksheet("Leaderboard");
  ws.addRow([
    "Rank",
    "Student",
    "Roll",
    "Org unit",
    rankedMetricCol,
    "CF rating",
    "CF solved",
    "LC rating",
    "LC solved",
    "CC rating",
    "CC solved",
    "Status",
    "Last updated",
  ]);
  ws.getRow(1).font = HEADER_FONT;
  ws.views = FROZEN;
  ws.getColumn(2).width = 26;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 20;
  ws.getColumn(5).width = 16;
  ws.getColumn(12).width = 12;
  ws.getColumn(13).width = 22;

  for (const r of rows) {
    ws.addRow([
      r.rank ?? "—",
      r.fullName,
      r.rollNumber,
      r.orgUnitName ?? "—",
      dash(r.metricValue),
      statValue(r, CodingPlatform.CODEFORCES, "rating"),
      statValue(r, CodingPlatform.CODEFORCES, "problemsSolved"),
      statValue(r, CodingPlatform.LEETCODE, "rating"),
      statValue(r, CodingPlatform.LEETCODE, "problemsSolved"),
      statValue(r, CodingPlatform.CODECHEF, "rating"),
      statValue(r, CodingPlatform.CODECHEF, "problemsSolved"),
      r.rankedStatus,
      r.rankedLastFetchedAt
        ? new Date(r.rankedLastFetchedAt).toISOString().slice(0, 10)
        : "—",
    ]);
  }

  // Counts footer (honest — ranked over ok stats only).
  ws.addRow([]);
  ws.addRow([
    "",
    `Ranked ${overview.ranked} of ${overview.linked} linked · ${overview.unranked} not ranked (na/stale) · ${overview.totalStudents} students in view`,
  ]);
  ws.getRow(ws.rowCount).font = HEADER_FONT;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
