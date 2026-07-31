import { useNavigate } from "react-router-dom";

import { PageHeader } from "../components/layout/PageHeader.js";
import { Card, CardContent } from "../components/ui/card.js";
import { useToast } from "../components/ui/toast.js";
import { ChangePasswordForm } from "./auth/ChangePasswordForm.js";

/** Voluntary change-password screen (inside the app shell). */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="Change password"
        description="Update your password. Other sessions will be signed out."
        breadcrumbs={[
          { label: "Dashboard", href: "/app" },
          { label: "Change password" },
        ]}
      />
      <Card>
        <CardContent className="pt-6">
          <ChangePasswordForm
            onSuccess={() => {
              toast({ variant: "success", title: "Password updated" });
              navigate("/app");
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
