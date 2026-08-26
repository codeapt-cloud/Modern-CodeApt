/**
 * Pure tests for the unified history VIEW helpers (labels, status → badge
 * variant, module filtering + counts, review deep-links, date). No DOM — the
 * AttemptHistory component is a thin renderer over these.
 */
import type { HistoryEntry } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  HISTORY_FILTERS,
  filterEntries,
  historyDate,
  historyEntryHref,
  historyOpensInPlace,
  moduleCounts,
  moduleLabel,
  statusBadge,
} from "../src/lib/history-view.js";

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  module: "exam",
  attemptId: "a1",
  assessmentId: "x1",
  title: "T",
  status: "graded",
  scorePercent: 80,
  scoreLabel: "80%",
  passed: true,
  band: null,
  startedAt: null,
  completedAt: null,
  gradingPending: false,
  engine: null,
  rescored: false,
  flagged: false,
  ...over,
});

describe("moduleLabel", () => {
  it("labels each module", () => {
    expect(moduleLabel("exam")).toBe("Exam");
    expect(moduleLabel("speaking")).toBe("Speaking");
    expect(moduleLabel("communication")).toBe("Communication");
    expect(moduleLabel("essay")).toBe("Essay");
    expect(moduleLabel("game")).toBe("Game");
  });
});

describe("statusBadge", () => {
  it("maps status to label + variant", () => {
    expect(statusBadge("graded")).toEqual({ label: "Graded", variant: "success" });
    expect(statusBadge("grading").variant).toBe("info");
    expect(statusBadge("in_progress").variant).toBe("neutral");
    expect(statusBadge("expired").variant).toBe("warning");
    expect(statusBadge("terminated").variant).toBe("error");
  });
});

describe("filterEntries + moduleCounts", () => {
  const entries = [
    entry({ module: "exam" }),
    entry({ module: "exam" }),
    entry({ module: "speaking" }),
    entry({ module: "game" }),
  ];
  it("'all' returns everything; a module returns only its rows", () => {
    expect(filterEntries(entries, "all")).toHaveLength(4);
    expect(filterEntries(entries, "exam")).toHaveLength(2);
    expect(filterEntries(entries, "essay")).toHaveLength(0);
  });
  it("counts per filter (all + each module)", () => {
    const c = moduleCounts(entries);
    expect(c.all).toBe(4);
    expect(c.exam).toBe(2);
    expect(c.speaking).toBe(1);
    expect(c.essay).toBe(0);
  });
  it("exposes a stable filter order beginning with 'all'", () => {
    expect(HISTORY_FILTERS[0]).toBe("all");
    expect(HISTORY_FILTERS).toContain("communication");
  });
});

describe("historyEntryHref", () => {
  it("links essays to the writer, keying the tenant off ?c= on the college surface", () => {
    const e = entry({ module: "essay", assessmentId: "topic9" });
    expect(historyEntryHref(e, "b2c")).toBe("/essays/topic9");
    expect(historyEntryHref(e, "college", "acme")).toBe("/essays/topic9?c=acme");
  });
  it("links communication composites to the right per-surface route", () => {
    const e = entry({ module: "communication", assessmentId: "cmp3" });
    expect(historyEntryHref(e, "b2c")).toBe("/communication/cmp3");
    expect(historyEntryHref(e, "college", "acme")).toBe(
      "/c/acme/communication/assessments/cmp3",
    );
  });
  it("has no standalone review route for exam/speaking/game (they open in place)", () => {
    expect(historyEntryHref(entry({ module: "exam" }), "b2c")).toBeNull();
    expect(historyEntryHref(entry({ module: "speaking" }), "b2c")).toBeNull();
    expect(historyEntryHref(entry({ module: "game" }), "b2c")).toBeNull();
  });
});

describe("historyOpensInPlace", () => {
  it("exam/speaking/game open in the in-place drawer; essay/communication navigate", () => {
    expect(historyOpensInPlace("exam")).toBe(true);
    expect(historyOpensInPlace("speaking")).toBe(true);
    expect(historyOpensInPlace("game")).toBe(true);
    expect(historyOpensInPlace("essay")).toBe(false);
    expect(historyOpensInPlace("communication")).toBe(false);
  });

  it("every module is openable — in place OR via a navigate link", () => {
    for (const m of ["exam", "speaking", "game", "essay", "communication"] as const) {
      const e = entry({ module: m, assessmentId: "x" });
      const openable =
        historyOpensInPlace(m) || historyEntryHref(e, "b2c") !== null;
      expect(openable).toBe(true);
    }
  });
});

describe("historyDate", () => {
  it("formats an ISO date and tolerates null/garbage", () => {
    expect(historyDate("2026-08-26T10:00:00.000Z")).toMatch(/2026/);
    expect(historyDate(null)).toBe("");
    expect(historyDate("not-a-date")).toBe("");
  });
});
