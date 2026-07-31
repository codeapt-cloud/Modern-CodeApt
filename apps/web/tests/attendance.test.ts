/**
 * Attendance module — pure helpers + the shared entitlement CATALOG entry.
 * Proves: membership de-dup keeps the FIRST source (stable union), roll-number
 * cleanup (trim / dedupe / drop blanks), and that `attendance` is a first-class
 * catalog feature (so a super-admin can grant it, and the nav/entitlement UI
 * surface it automatically).
 */
import {
  AttendanceMemberSource,
  COLLEGE_FEATURE_VALUES,
  CollegeFeature,
  SUB_CAPABILITY_CATALOG,
  attendanceRate,
  dedupeMembers,
  isBelowThreshold,
  tallyAttendance,
  uniqueRollNumbers,
  type MemberCandidate,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("dedupeMembers", () => {
  it("keeps the FIRST occurrence (its source + ref win), order preserved", () => {
    const candidates: MemberCandidate[] = [
      { studentId: "a", source: AttendanceMemberSource.ORG_UNIT, sourceRef: "u1" },
      { studentId: "b", source: AttendanceMemberSource.SECTION, sourceRef: "u2" },
      // 'a' again via a different method → dropped (org_unit provenance kept).
      { studentId: "a", source: AttendanceMemberSource.INDIVIDUAL, sourceRef: null },
      { studentId: "c", source: AttendanceMemberSource.EXCEL, sourceRef: null },
      { studentId: "b", source: AttendanceMemberSource.EXCEL, sourceRef: null },
    ];
    const out = dedupeMembers(candidates);
    expect(out.map((m) => m.studentId)).toEqual(["a", "b", "c"]);
    expect(out[0]).toMatchObject({
      source: AttendanceMemberSource.ORG_UNIT,
      sourceRef: "u1",
    });
    expect(out[1]).toMatchObject({
      source: AttendanceMemberSource.SECTION,
      sourceRef: "u2",
    });
  });

  it("is a no-op on an already-unique list", () => {
    const c: MemberCandidate[] = [
      { studentId: "x", source: AttendanceMemberSource.INDIVIDUAL, sourceRef: null },
    ];
    expect(dedupeMembers(c)).toHaveLength(1);
  });
});

describe("uniqueRollNumbers", () => {
  it("trims, de-duplicates, and drops blanks", () => {
    expect(uniqueRollNumbers([" R1 ", "R1", "", "R2", "  ", "R2"])).toEqual([
      "R1",
      "R2",
    ]);
  });
});

describe("tallyAttendance (Prompt 2 counts)", () => {
  it("counts present, derives absent from the roster total", () => {
    expect(tallyAttendance(["present", "absent", "present"], 3)).toEqual({
      present: 2,
      absent: 1,
      total: 3,
    });
  });
  it("treats unmarked members as absent (present < total)", () => {
    // 1 present recorded, roster of 4 → 3 absent.
    expect(tallyAttendance(["present"], 4)).toEqual({
      present: 1,
      absent: 3,
      total: 4,
    });
  });
  it("never goes negative if present somehow exceeds the given total", () => {
    expect(tallyAttendance(["present", "present"], 1)).toEqual({
      present: 2,
      absent: 0,
      total: 2,
    });
  });
});

describe("attendanceRate + isBelowThreshold (fair denominator)", () => {
  it("computes a rounded % over recorded marks", () => {
    expect(attendanceRate(3, 6)).toBe(50);
    expect(attendanceRate(2, 3)).toBe(66.7);
    expect(attendanceRate(2, 2)).toBe(100);
  });
  it("returns null (no data) when there are no recorded sessions — never a fake 0%", () => {
    expect(attendanceRate(0, 0)).toBeNull();
  });
  it("flags a real rate below the threshold; never flags no-data", () => {
    expect(isBelowThreshold(50, 75)).toBe(true);
    expect(isBelowThreshold(80, 75)).toBe(false);
    expect(isBelowThreshold(75, 75)).toBe(false); // exactly at threshold = OK
    expect(isBelowThreshold(null, 75)).toBe(false); // no data is not a defaulter
  });
});

describe("attendance entitlement catalog", () => {
  it("is a first-class feature in the shared catalog", () => {
    expect(COLLEGE_FEATURE_VALUES).toContain("attendance");
    expect(CollegeFeature.ATTENDANCE).toBe("attendance");
  });
  it("has a (currently empty) sub-capability list", () => {
    expect(SUB_CAPABILITY_CATALOG[CollegeFeature.ATTENDANCE]).toEqual([]);
  });
});
