import { ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { useToast } from "../../components/ui/toast.js";
import { AuthLayout } from "./AuthLayout.js";
import { ChangePasswordForm } from "./ChangePasswordForm.js";

/**
 * Blocking screen shown when the server flags `forcePasswordChange`. The route
 * guards keep the user here (and out of the app) until the change succeeds.
 */
export function ForcedPasswordChangePage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="For your security, you must change your password before continuing."
    >
      <div className="space-y-5">
        <Alert variant="warning" title="Password change required">
          <span className="flex items-center gap-1.5">
            <ShieldAlert className="h-4 w-4" />
            Your account requires a new password to proceed.
          </span>
        </Alert>
        <ChangePasswordForm
          submitLabel="Set password & continue"
          onSuccess={() => {
            toast({ variant: "success", title: "Password updated" });
            // Land at "/" so a college operator (e.g. a just-provisioned admin
            // setting their first password) goes to their workspace.
            navigate("/", { replace: true });
          }}
        />
      </div>
    </AuthLayout>
  );
}
