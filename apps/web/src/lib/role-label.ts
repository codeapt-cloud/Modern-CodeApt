/**
 * Human labels for authority roles — used in the college workspace (account
 * menu, dashboard header) to show the operator's role. Pure + framework-free.
 */
import { Role, type Role as RoleT } from "@codeapt/shared";

const LABELS: Record<RoleT, string> = {
  [Role.STUDENT]: "Student",
  [Role.ADMIN]: "Administrator",
  [Role.SUPER_ADMIN]: "Platform admin",
  [Role.COLLEGE_ADMIN]: "College admin",
  [Role.FACULTY]: "Faculty",
};

/** "college_admin" → "College admin". Falls back to the raw role if unknown. */
export function roleLabel(role: RoleT): string {
  return LABELS[role] ?? role;
}
