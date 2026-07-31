/**
 * College-space entry gate — the coarse client guard for /c/:slug/... . College
 * operators, platform admins, AND college students may enter; individual (B2C)
 * learners may not. Regression: a college student (role=student, userType=college)
 * MUST be admitted, else "Back to college" / the student home bounce to /app.
 */
import { Role, UserType } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import { canEnterCollegeSpace } from "../src/lib/college-access.js";

describe("canEnterCollegeSpace", () => {
  it("admits college operators and platform admins", () => {
    expect(canEnterCollegeSpace(Role.COLLEGE_ADMIN, UserType.COLLEGE)).toBe(true);
    expect(canEnterCollegeSpace(Role.FACULTY, UserType.COLLEGE)).toBe(true);
    expect(canEnterCollegeSpace(Role.SUPER_ADMIN, UserType.INDIVIDUAL)).toBe(true);
    expect(canEnterCollegeSpace(Role.ADMIN, UserType.INDIVIDUAL)).toBe(true);
  });

  it("admits a college STUDENT (the regression)", () => {
    expect(canEnterCollegeSpace(Role.STUDENT, UserType.COLLEGE)).toBe(true);
  });

  it("bounces an individual (B2C) learner", () => {
    expect(canEnterCollegeSpace(Role.STUDENT, UserType.INDIVIDUAL)).toBe(false);
  });
});
