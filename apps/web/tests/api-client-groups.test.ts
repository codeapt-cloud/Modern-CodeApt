/**
 * Shape guard for the tenant-scoped api-client groups added in Phase 2b — the
 * routing/URL wiring lives in these thin wrappers, so a smoke test that the
 * groups + methods exist (and are functions) catches accidental renames/removals.
 */
import { describe, expect, it } from "vitest";

import { api } from "../src/lib/api-client.js";

describe("api-client — Phase 2b tenant groups", () => {
  it("exposes me.college()", () => {
    expect(typeof api.me.college).toBe("function");
  });

  it("exposes the public branding read (used by the branded login page)", () => {
    expect(typeof api.public.collegeBranding).toBe("function");
  });

  it("exposes collegeContext.get", () => {
    expect(typeof api.collegeContext.get).toBe("function");
  });

  it("exposes the collegeOrgUnits group", () => {
    for (const m of ["listTree", "create", "update", "remove", "bulkCreate"]) {
      expect(typeof (api.collegeOrgUnits as Record<string, unknown>)[m]).toBe(
        "function",
      );
    }
  });

  it("exposes the collegeFaculty group", () => {
    for (const m of ["list", "create", "update", "deactivate"]) {
      expect(typeof (api.collegeFaculty as Record<string, unknown>)[m]).toBe(
        "function",
      );
    }
  });

  it("exposes the collegeStudents group", () => {
    for (const m of [
      "list",
      "create",
      "deactivate",
      "importPreview",
      "importCommit",
      "template",
    ]) {
      expect(typeof (api.collegeStudents as Record<string, unknown>)[m]).toBe(
        "function",
      );
    }
  });

  it("exposes the collegeCourses group", () => {
    for (const m of ["list", "assignedStudents", "assign", "revoke"]) {
      expect(typeof (api.collegeCourses as Record<string, unknown>)[m]).toBe(
        "function",
      );
    }
  });
});
