/**
 * Graceful landing for a college operator (college_admin/faculty) whose account
 * has no resolvable college — rather than looping on a redirect, show a clear
 * message with a way into the personal learner app and a sign-out. Rare (a
 * mis-provisioned account); prevents a crash/loop.
 */
import { Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import { useToast } from "../components/ui/toast.js";
import { useAuth } from "../providers/AuthProvider.js";

export function NoCollegeHome() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { toast } = useToast();

  const signOut = async () => {
    await logout();
    toast({ title: "Signed out" });
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <Card className="max-w-md space-y-4 p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Building2 className="h-6 w-6" />
        </span>
        <h1 className="text-lg font-semibold text-ink">
          No college linked to your account
        </h1>
        <p className="text-sm text-ink-muted">
          Your account is a college operator but isn&apos;t linked to a college
          yet. Please contact your CodeApt administrator.
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={() => navigate("/app")}>
            Go to personal account
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
