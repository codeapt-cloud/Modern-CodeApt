/**
 * Tenant-scoping helper + pure entitlement logic (Phase 0) — the unit-level
 * proof that college-scoped queries CANNOT run unscoped and that one entitlement
 * check governs everything. Includes a real cross-tenant DB proof: docs of two
 * colleges in one collection, scoped reads return only the caller's tenant.
 */
import {
  buildDefaultEntitlements,
  checkEntitlement,
  CollegeFeature,
  isCourseGranted,
  type CollegeEntitlements,
} from "@codeapt/shared";
import mongoose, { Schema, Types } from "mongoose";
import { describe, expect, it } from "vitest";

import { createTenantScope } from "../src/lib/tenant-scope.js";

// Ephemeral college-scoped model — stands in for the college-scoped feature
// models that later phases add. Registered once for the whole test run.
const thingSchema = new Schema({
  college: { type: Schema.Types.ObjectId, index: true },
  label: String,
});
const ThingModel =
  mongoose.models.TenantThing ?? mongoose.model("TenantThing", thingSchema);

describe("createTenantScope", () => {
  it("injects the college into filters and onto new documents", () => {
    const id = new Types.ObjectId();
    const scope = createTenantScope(id);

    const filter = scope.filter({ status: "active" });
    expect(filter.status).toBe("active");
    expect(filter.college.equals(id)).toBe(true);

    expect(scope.filter().college.equals(id)).toBe(true);

    const doc = scope.attach({ label: "x" });
    expect(doc.label).toBe("x");
    expect(doc.college.equals(id)).toBe(true);
  });

  it("REFUSES to build a scope without a valid tenant id", () => {
    expect(() => createTenantScope(null)).toThrow();
    expect(() => createTenantScope(undefined)).toThrow();
    expect(() => createTenantScope("not-an-object-id")).toThrow();
  });

  it("isolates reads across tenants in a shared collection", async () => {
    const collegeA = new Types.ObjectId();
    const collegeB = new Types.ObjectId();
    await ThingModel.create([
      { college: collegeA, label: "a1" },
      { college: collegeA, label: "a2" },
      { college: collegeB, label: "b1" },
    ]);

    const scopeA = createTenantScope(collegeA);
    const scopeB = createTenantScope(collegeB);

    const aRows = await ThingModel.find(scopeA.filter()).lean();
    const bRows = await ThingModel.find(scopeB.filter()).lean();

    expect(aRows.map((r) => r.label).sort()).toEqual(["a1", "a2"]);
    expect(bRows.map((r) => r.label)).toEqual(["b1"]);
    // College A's scope can NEVER see College B's row.
    expect(aRows.some((r) => r.label === "b1")).toBe(false);
  });
});

describe("checkEntitlement / isCourseGranted (pure)", () => {
  const base = (): CollegeEntitlements => buildDefaultEntitlements();

  it("feature OFF → false; ON → true", () => {
    const e = base();
    expect(checkEntitlement(e, CollegeFeature.EXAMS)).toBe(false);
    e.features[CollegeFeature.EXAMS] = true;
    expect(checkEntitlement(e, CollegeFeature.EXAMS)).toBe(true);
  });

  it("sub-capability: needs BOTH the feature and the sub-capability on", () => {
    const e = base();
    // Feature off → even a set sub-capability is denied.
    e.subCapabilities["exams.public_links"] = true;
    expect(
      checkEntitlement(e, CollegeFeature.EXAMS, "public_links"),
    ).toBe(false);

    // Feature on, sub-capability off → denied.
    e.features[CollegeFeature.EXAMS] = true;
    e.subCapabilities["exams.public_links"] = false;
    expect(
      checkEntitlement(e, CollegeFeature.EXAMS, "public_links"),
    ).toBe(false);

    // Both on → allowed.
    e.subCapabilities["exams.public_links"] = true;
    expect(
      checkEntitlement(e, CollegeFeature.EXAMS, "public_links"),
    ).toBe(true);
  });

  it("course grants are membership in grantedCourses", () => {
    const e = base();
    const courseId = new Types.ObjectId().toString();
    expect(isCourseGranted(e, courseId)).toBe(false);
    e.grantedCourses.push(courseId);
    expect(isCourseGranted(e, courseId)).toBe(true);
  });
});
