/**
 * Post-auth landing decision — a college operator lands in their workspace, a
 * college student in their student space (/c/:slug/home), and everyone else
 * (individual learners, platform admins) in the learner app. userType is what
 * separates a college student from an individual learner (both are role=student).
 */
import { Role, UserType } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import { homePathForUser } from "../src/lib/home-nav.js";

describe("homePathForUser", () => {
  it("sends a college_admin / faculty with a college to their workspace dashboard", () => {
    expect(homePathForUser(Role.COLLEGE_ADMIN, UserType.COLLEGE, "ace")).toBe(
      "/c/ace",
    );
    expect(homePathForUser(Role.FACULTY, UserType.COLLEGE, "ace")).toBe(
      "/c/ace",
    );
  });

  it("sends a COLLEGE STUDENT (role=student, userType=college) to their student home", () => {
    expect(homePathForUser(Role.STUDENT, UserType.COLLEGE, "ace")).toBe(
      "/c/ace/home",
    );
  });

  it("sends individual learners and platform admins to /app", () => {
    // An INDIVIDUAL learner is role=student too — userType keeps them in /app
    // even if a slug were somehow present.
    expect(homePathForUser(Role.STUDENT, UserType.INDIVIDUAL, "ace")).toBe(
      "/app",
    );
    expect(homePathForUser(Role.STUDENT, UserType.INDIVIDUAL, null)).toBe(
      "/app",
    );
    expect(homePathForUser(Role.SUPER_ADMIN, UserType.INDIVIDUAL, null)).toBe(
      "/app",
    );
    expect(homePathForUser(Role.ADMIN, UserType.INDIVIDUAL, null)).toBe("/app");
  });

  it("falls back to /app for a college member with no resolvable college", () => {
    expect(homePathForUser(Role.COLLEGE_ADMIN, UserType.COLLEGE, null)).toBe(
      "/app",
    );
    expect(homePathForUser(Role.FACULTY, UserType.COLLEGE, undefined)).toBe(
      "/app",
    );
    expect(homePathForUser(Role.STUDENT, UserType.COLLEGE, null)).toBe("/app");
  });
});
