/**
 * Pure launcher-visibility rules for the admin assistant (Step 39). The assistant
 * is visible ONLY to callers who actually have it — mirrors the server gate:
 *   - super admin: always (platform-wide);
 *   - college admin: only when the college has the `ai.admin_assistant`
 *     sub-capability (a super admin enabled it);
 *   - faculty / students: never.
 * A college without the capability must see NO launcher at all. Kept pure so the
 * absence is unit-testable without rendering the chrome.
 */
import {
  CollegeFeature,
  Role,
  checkEntitlement,
  isPlatformAdmin,
  type CollegeEntitlements,
  type Role as RoleT,
} from "@codeapt/shared";

/** Platform chrome (AppShell): only platform admins get the assistant there. */
export function assistantAvailableOnPlatform(
  userRole: RoleT | undefined,
): boolean {
  return !!userRole && isPlatformAdmin(userRole);
}

/** College chrome (CollegeTopNav): a super admin always; a college admin only
 *  when the tenant has ai.admin_assistant. Faculty/students never. */
export function assistantAvailableInCollege(params: {
  userRole: RoleT | undefined;
  membershipRole: RoleT;
  entitlements: CollegeEntitlements;
}): boolean {
  if (params.userRole && isPlatformAdmin(params.userRole)) return true;
  return (
    params.membershipRole === Role.COLLEGE_ADMIN &&
    checkEntitlement(params.entitlements, CollegeFeature.AI, "admin_assistant")
  );
}
