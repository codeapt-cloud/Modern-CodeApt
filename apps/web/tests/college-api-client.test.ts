/**
 * api-client shape (Phase 1) — the admin colleges group exposes exactly the
 * Phase 0 provisioning + entitlement methods, so the console wires to the real
 * API. Shape-only (no network).
 */
import { describe, expect, it } from "vitest";

import { api } from "../src/lib/api-client.js";

describe("api.adminColleges group", () => {
  it("exposes the full provisioning + entitlement method set", () => {
    const g = api.adminColleges;
    for (const method of [
      "list",
      "get",
      "create",
      "update",
      "setEntitlements",
      "grantCourses",
      "revokeCourses",
    ] as const) {
      expect(typeof g[method]).toBe("function");
    }
  });
});

describe("api.collegeExams group", () => {
  it("exposes authoring + the student take (list/start) methods", () => {
    const g = api.collegeExams;
    for (const method of [
      // authoring (Phase 4b-ii-A)
      "list",
      "create",
      "get",
      "update",
      "remove",
      "setPublished",
      "results",
      "resetAttempts",
      "createSection",
      "createQuestion",
      "addTestCase",
      "bulkUpload",
      "bulkUploadTemplate",
      "createPublicLink",
      // student take surface (Phase 4b-ii-B)
      "studentList",
      "studentStart",
    ] as const) {
      expect(typeof g[method]).toBe("function");
    }
  });
});

describe("api.collegeAnalytics group", () => {
  it("exposes the three rollup reads (overview / by-org-unit / student)", () => {
    const g = api.collegeAnalytics;
    for (const method of ["overview", "byOrgUnit", "student"] as const) {
      expect(typeof g[method]).toBe("function");
    }
  });
});

describe("api.collegeCareers group", () => {
  it("exposes authoring + applications + the student browse/apply methods", () => {
    const g = api.collegeCareers;
    for (const method of [
      // authoring (Phase 5b)
      "list",
      "get",
      "create",
      "update",
      "setPublished",
      "remove",
      "applications",
      "updateApplicationStatus",
      // student browse/apply surface
      "studentList",
      "studentGet",
      "studentApply",
    ] as const) {
      expect(typeof g[method]).toBe("function");
    }
  });
});
