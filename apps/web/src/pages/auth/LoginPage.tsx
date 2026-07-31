import { Link } from "react-router-dom";

import { AuthLayout } from "./AuthLayout.js";
import { LoginForm } from "./LoginForm.js";

export function LoginPage() {
  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to continue your placement prep."
      footer={
        <>
          New to CodeApt?{" "}
          <Link
            to="/register"
            className="font-medium text-primary hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthLayout>
  );
}
