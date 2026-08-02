/**
 * College workspace layout — the tenant-scoped shell for /c/:collegeSlug/... . It
 * resolves the tenant context (GET /c/:slug/context) which is the REAL boundary:
 * a non-member or a suspended college 403s here and we render an access state
 * instead of the workspace. On success it renders the CollegeTopNav shell (a
 * product-style top navigation — NOT the learner sidebar) and hands the resolved
 * context down to child pages via the router outlet context.
 *
 * The nav is entitlement-aware and catalog-driven (see lib/college-nav): the
 * college's enabled features decide which sections link, which show "Not
 * enabled", and which are "coming soon". The account menu keeps the "Switch to
 * personal account" action so an operator can hop to the learner app. The shell
 * is full-width — CollegeLayout is a top-level route, not nested in AppShell.
 */
import { Building2 } from "lucide-react";
import { Outlet, useNavigate, useParams } from "react-router-dom";

import { CollegeTopNav } from "../../components/colleges/CollegeTopNav.js";
import { Alert } from "../../components/ui/alert.js";
import { Card } from "../../components/ui/card.js";
import { Spinner } from "../../components/ui/spinner.js";
import { useToast } from "../../components/ui/toast.js";
import { api } from "../../lib/api-client.js";
import { imageUrl } from "../../lib/cloudinary.js";
import { useQuery } from "../../lib/use-query.js";
import { useAuth } from "../../providers/AuthProvider.js";
import { type CollegeOutletContext } from "./college-context.js";

export function CollegeLayout() {
  const { collegeSlug = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, profile, logout } = useAuth();

  const { data, loading, error, refetch } = useQuery(
    () => api.collegeContext.get(collegeSlug),
    [collegeSlug],
  );

  const handleLogout = async () => {
    await logout();
    toast({ title: "Signed out" });
    navigate("/login", { replace: true });
  };

  const shellUser = {
    name: profile?.fullName ?? user?.username ?? "User",
    email: user?.email ?? "",
    avatarUrl: imageUrl(profile?.avatarUrl),
  };

  // Access / loading states render WITHOUT the tenant chrome (there's no
  // resolved context to build the nav from yet).
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-6">
        <Card className="max-w-lg space-y-3 p-8 text-center">
          <Building2 className="mx-auto h-10 w-10 text-ink-muted" />
          <h1 className="text-lg font-semibold text-ink">
            College space unavailable
          </h1>
          <Alert variant="error">
            {error ?? "This college could not be resolved."}
          </Alert>
          <p className="text-sm text-ink-muted">
            You may not be a member of this college, or it may be suspended.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <CollegeTopNav
        slug={collegeSlug}
        collegeName={data.college.name}
        collegeStatus={data.college.status}
        role={data.membership.role}
        entitlements={data.entitlements}
        user={shellUser}
        onLogout={handleLogout}
      />
      <main className="mx-auto w-full min-w-0 max-w-7xl p-4 sm:p-6 lg:p-8">
        <Outlet
          context={
            {
              slug: collegeSlug,
              context: data,
              refetchContext: refetch,
            } satisfies CollegeOutletContext
          }
        />
      </main>
    </div>
  );
}
