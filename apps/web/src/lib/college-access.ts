/**
 * Pure client gate for the college space (/c/:slug/...). A user may enter when
 * they are a college OPERATOR or platform admin (via FACULTY_ROLES) OR a college
 * STUDENT (role=student + userType=college). Individual (B2C) learners cannot.
 * The real boundary is still server-side (resolveTenant); this only decides
 * whether to render the space vs. bounce home. Unit-tested.
 */
import {
  FACULTY_ROLES,
  isCollegeStudent,
  type Role,
  type UserType,
} from "@codeapt/shared";

export function canEnterCollegeSpace(role: Role, userType: UserType): boolean {
  return FACULTY_ROLES.includes(role) || isCollegeStudent(role, userType);
}
