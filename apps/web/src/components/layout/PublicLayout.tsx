/**
 * Public shell for logged-out AND logged-in visitors — wraps the informational
 * and legal pages (about / contact / training / placements / terms / privacy /
 * refund-policy). A slim header (logo + public nav + theme toggle + an
 * auth-aware CTA) over an <Outlet />, with the shared Footer beneath. Uses
 * tokens + ui/ primitives only; reduced-motion-safe (no entrance animation).
 */
import { NavLink, Link, Outlet } from "react-router-dom";

import { cn } from "../../lib/cn.js";
import { useAuth } from "../../providers/AuthProvider.js";
import { ThemeToggle } from "../ThemeToggle.js";
import { Logo } from "../brand/Logo.js";
import { Button } from "../ui/button.js";
import { Footer } from "./Footer.js";

const nav = [
  { label: "About", to: "/about" },
  { label: "Training", to: "/training" },
  { label: "Placements", to: "/placements" },
  { label: "Contact", to: "/contact" },
];

export function PublicLayout() {
  const { status } = useAuth();
  const authed = status === "authenticated";

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="sticky top-0 z-sticky border-b border-subtle bg-surface-raised/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="CodeApt home" className="shrink-0">
            <Logo className="h-7" />
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {nav.map(({ label, to }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "text-primary"
                      : "text-ink-secondary hover:bg-surface-overlay hover:text-ink",
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild size="sm">
              <Link to={authed ? "/app" : "/login"}>
                {authed ? "Go to app" : "Log in"}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
