/**
 * Post-auth landing decision (pure, testable). Three homes, by member type:
 *   - a college OPERATOR (college_admin / faculty) whose college resolves →
 *     their workspace dashboard at /c/:slug (the manage shell).
 *   - a college STUDENT (role=student, userType=college) whose college resolves
 *     → their student space home at /c/:slug/home (the consume shell), a path
 *     DISTINCT from the operator's so the shell/nav can't be confused.
 *   - everyone else — individual (B2C) learners and platform admins — → the
 *     learner app at /app (unchanged).
 * A college member with no resolvable college returns "/app" here as a safe
 * fallback; the caller (RootRoute) shows a dedicated "no college" state instead
 * of redirecting, so there's never a loop.
 */
import {
  isCollegeOperator,
  isCollegeStudent,
  type Role,
  type UserType,
} from "@codeapt/shared";

export function homePathForUser(
  role: Role,
  userType: UserType,
  collegeSlug: string | null | undefined,
): string {
  if (isCollegeOperator(role) && collegeSlug) {
    return `/c/${collegeSlug}`;
  }
  if (isCollegeStudent(role, userType) && collegeSlug) {
    return `/c/${collegeSlug}/home`;
  }
  return "/app";
}
