/**
 * College nav model — proves the workspace nav/tiles are catalog-driven and
 * entitlement-aware: member-open sections are always available, feature-backed
 * sections lock when the college isn't entitled, and roadmap sections stay
 * "coming soon" regardless of entitlement.
 */
import {
  buildDefaultEntitlements,
  type CollegeEntitlements,
  type CollegeFeature,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  COLLEGE_NAV_GROUPS,
  COLLEGE_SECTIONS,
  STUDENT_COLLEGE_SECTIONS,
  buildCollegeNav,
  buildStudentCollegeNav,
  resolveSections,
  sectionHref,
  sectionStatus,
} from "../src/lib/college-nav.js";

function withFeatures(
  features: Partial<Record<CollegeFeature, boolean>>,
): CollegeEntitlements {
  const e = buildDefaultEntitlements();
  e.features = { ...features };
  return e;
}

const bySection = (key: string) => {
  const s = COLLEGE_SECTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`no section ${key}`);
  return s;
};

describe("sectionStatus", () => {
  it("member-open sections (no feature) are always available", () => {
    const none = buildDefaultEntitlements();
    expect(sectionStatus(bySection("structure"), none)).toBe("available");
    expect(sectionStatus(bySection("students"), none)).toBe("available");
  });

  it("feature-backed sections lock when not entitled, unlock when granted", () => {
    const off = buildDefaultEntitlements();
    expect(sectionStatus(bySection("courses"), off)).toBe("locked");
    expect(sectionStatus(bySection("faculty"), off)).toBe("locked");
    expect(sectionStatus(bySection("import"), off)).toBe("locked");
    // Exams + essays + challenges are now BUILT feature-backed sections (Phase
    // 4b-ii / 4c-ii / 4d): they lock when the college isn't entitled, unlock
    // when the feature is on.
    expect(sectionStatus(bySection("exams"), off)).toBe("locked");
    expect(sectionStatus(bySection("essays"), off)).toBe("locked");
    expect(sectionStatus(bySection("challenges"), off)).toBe("locked");
    // Analytics is BUILT in Phase 5a-ii — feature-backed, not roadmap.
    expect(sectionStatus(bySection("analytics"), off)).toBe("locked");
    // Placements are BUILT in Phase 5b (the final feature) — feature-backed.
    expect(sectionStatus(bySection("jobs"), off)).toBe("locked");

    const on = withFeatures({
      courses: true,
      faculty_management: true,
      bulk_import: true,
      exams: true,
      essays: true,
      challenges: true,
      analytics: true,
      postings: true,
    });
    expect(sectionStatus(bySection("courses"), on)).toBe("available");
    expect(sectionStatus(bySection("faculty"), on)).toBe("available");
    expect(sectionStatus(bySection("import"), on)).toBe("available");
    expect(sectionStatus(bySection("exams"), on)).toBe("available");
    expect(sectionStatus(bySection("essays"), on)).toBe("available");
    expect(sectionStatus(bySection("challenges"), on)).toBe("available");
    expect(sectionStatus(bySection("analytics"), on)).toBe("available");
    expect(sectionStatus(bySection("jobs"), on)).toBe("available");
  });

  it("the whole catalog is built — no section is a coming-soon roadmap item", () => {
    // Phase 5b completes the multi-tenant spec: every catalogued section now
    // maps to a real page (member-open or feature-backed), none is coming_soon.
    for (const section of COLLEGE_SECTIONS) {
      expect(section.comingSoon).toBe(false);
      expect(section.path).not.toBeNull();
    }
  });
});

describe("buildCollegeNav", () => {
  it("groups sections in the fixed group order, dropping empty groups", () => {
    const groups = buildCollegeNav(buildDefaultEntitlements());
    const names = groups.map((g) => g.name);
    // Order is a subsequence of the canonical group order.
    const canonical = [...COLLEGE_NAV_GROUPS];
    let cursor = 0;
    for (const n of names) {
      cursor = canonical.indexOf(n, cursor);
      expect(cursor).toBeGreaterThanOrEqual(0);
    }
    // Every catalogued section is represented across the groups.
    const flat = groups.flatMap((g) => g.sections);
    expect(flat).toHaveLength(COLLEGE_SECTIONS.length);
  });

  it("carries a resolved status onto every section", () => {
    const groups = buildCollegeNav(withFeatures({ courses: true }));
    const courses = groups
      .flatMap((g) => g.sections)
      .find((s) => s.key === "courses");
    expect(courses?.status).toBe("available");
  });
});

describe("buildStudentCollegeNav (student consume nav)", () => {
  const OPERATOR_KEYS = new Set(COLLEGE_SECTIONS.map((s) => s.key));

  it("contains ONLY consume sections — never operator/manage ones", () => {
    const studentKeys = STUDENT_COLLEGE_SECTIONS.map((s) => s.key);
    // The student catalog is its own set of consume surfaces.
    expect(studentKeys).toEqual([
      "my-courses",
      "my-exams",
      "my-essays",
      "my-attendance",
      "my-coding",
      "my-games",
      "my-communication",
      "my-ai-credits",
      "my-results",
      "placements",
    ]);
    // None of the manage sections (structure/faculty/students/import/analytics)
    // leak into the student nav.
    for (const key of ["structure", "faculty", "students", "import", "analytics"]) {
      expect(OPERATOR_KEYS.has(key)).toBe(true); // sanity: it's an operator key
      expect(studentKeys).not.toContain(key);
    }
  });

  it("is entitlement-gated: feature-backed sections lock when off, unlock when on", () => {
    const off = buildDefaultEntitlements();
    const offFlat = buildStudentCollegeNav(off).flatMap((g) => g.sections);
    const status = (key: string) =>
      offFlat.find((s) => s.key === key)?.status;
    expect(status("my-courses")).toBe("locked");
    expect(status("my-exams")).toBe("locked");
    expect(status("my-essays")).toBe("locked");
    expect(status("placements")).toBe("locked");
    // "My results" is member-open (no feature) — always available.
    expect(status("my-results")).toBe("available");

    const on = buildStudentCollegeNav(
      withFeatures({ courses: true, exams: true, essays: true, postings: true }),
    ).flatMap((g) => g.sections);
    const onStatus = (key: string) => on.find((s) => s.key === key)?.status;
    expect(onStatus("my-courses")).toBe("available");
    expect(onStatus("my-exams")).toBe("available");
    expect(onStatus("my-essays")).toBe("available");
    expect(onStatus("placements")).toBe("available");
  });

  it("routes every student section to a real in-space page (none coming-soon)", () => {
    for (const s of STUDENT_COLLEGE_SECTIONS) {
      expect(s.comingSoon).toBe(false);
      expect(s.path).not.toBeNull();
    }
    // Part (ii): real /c/:slug section routes (no more my-* placeholders).
    expect(sectionHref("ace", bySection2("my-courses"))).toBe("/c/ace/courses");
    expect(sectionHref("ace", bySection2("my-exams"))).toBe("/c/ace/exams");
    expect(sectionHref("ace", bySection2("my-essays"))).toBe("/c/ace/essays");
    expect(sectionHref("ace", bySection2("my-results"))).toBe("/c/ace/results");
    expect(sectionHref("ace", bySection2("placements"))).toBe(
      "/c/ace/placements",
    );
  });
});

const bySection2 = (key: string) => {
  const s = STUDENT_COLLEGE_SECTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`no student section ${key}`);
  return s;
};

describe("resolveSections + sectionHref", () => {
  it("resolveSections keeps catalog order and length", () => {
    const resolved = resolveSections(buildDefaultEntitlements());
    expect(resolved.map((s) => s.key)).toEqual(
      COLLEGE_SECTIONS.map((s) => s.key),
    );
  });

  it("sectionHref builds routes (with query) and returns null for no-page sections", () => {
    expect(sectionHref("ace", bySection("structure"))).toBe("/c/ace/structure");
    expect(sectionHref("ace", bySection("import"))).toBe(
      "/c/ace/students?import=1",
    );
    expect(sectionHref("ace", bySection("exams"))).toBe("/c/ace/exams");
    expect(sectionHref("ace", bySection("essays"))).toBe("/c/ace/essays");
    // Placements are now live (Phase 5b).
    expect(sectionHref("ace", bySection("jobs"))).toBe("/c/ace/postings");
  });
});
