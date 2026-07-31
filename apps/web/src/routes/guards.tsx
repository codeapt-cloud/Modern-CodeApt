/**
 * Route guards driven by AuthProvider state.
 * - ProtectedRoute: requires auth; bounces forced-change users to the gate.
 * - GuestOnlyRoute: redirects already-authed users away from login/register.
 * - ForcedPasswordChangeRoute: only reachable while a change is pending.
 */
import { isPlatformAdmin } from "@codeapt/shared";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Spinner } from "../components/ui/spinner.js";
import { canEnterCollegeSpace } from "../lib/college-access.js";
import { useAuth } from "../providers/AuthProvider.js";

function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-3">
        <span className="font-mono text-2xl text-primary" aria-hidden="true">
          {"{ }"}
        </span>
        <Spinner />
      </div>
    </div>
  );
}

export function ProtectedRoute() {
  const { status, mustChangePassword } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageLoader />;
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (mustChangePassword) {
    return <Navigate to="/forced-password-change" replace />;
  }
  return <Outlet />;
}

export function GuestOnlyRoute() {
  const { status, mustChangePassword } = useAuth();

  if (status === "loading") return <FullPageLoader />;
  if (status === "authenticated") {
    // "/" lets RootRoute route a college operator to their workspace and
    // everyone else to the learner app.
    return (
      <Navigate
        to={mustChangePassword ? "/forced-password-change" : "/"}
        replace
      />
    );
  }
  return <Outlet />;
}

/**
 * Platform-admin sub-guard (nest inside ProtectedRoute). Accepts super_admin AND
 * legacy admin (the shared PLATFORM_ADMIN_ROLES set), matching the Phase 0
 * backend `requireAdmin`/`requireSuperAdmin` mapping — so the admin surface
 * (including the college console) is reachable by platform admins after the
 * tenancy backfill maps admin → super_admin. Everyone else bounces home.
 */
export function RequireAdmin() {
  const { user } = useAuth();
  if (!user || !isPlatformAdmin(user.role)) {
    return <Navigate to="/app" replace />;
  }
  return <Outlet />;
}

/**
 * College-space sub-guard (nest inside ProtectedRoute) for /c/:slug/... . Coarse
 * client gate: college OPERATORS (college_admin / faculty), platform admins, AND
 * college STUDENTS (role=student + userType=college) may enter a college space;
 * individual (B2C) learners bounce home. The PRECISE boundary — that the slug is
 * a college this user actually belongs to (and isn't suspended) — is enforced
 * server-side by resolveTenant, and the college layout renders the access-denied
 * state when that context fetch 403s.
 */
export function RequireCollegeMember() {
  const { user } = useAuth();
  if (!user || !canEnterCollegeSpace(user.role, user.userType)) {
    return <Navigate to="/app" replace />;
  }
  return <Outlet />;
}

export function ForcedPasswordChangeRoute() {
  const { status, mustChangePassword } = useAuth();

  if (status === "loading") return <FullPageLoader />;
  if (status === "unauthenticated") return <Navigate to="/login" replace />;
  if (!mustChangePassword) return <Navigate to="/app" replace />;
  return <Outlet />;
}
