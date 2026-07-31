import { type ReactNode } from "react";

import { Logo } from "../../components/brand/Logo.js";
import { Reveal } from "../../components/motion/index.js";
import { ThemeToggle } from "../../components/ThemeToggle.js";
import { AuthHero } from "./AuthHero.js";

/**
 * Split auth layout: the form (left) beside a branded hero panel (right,
 * desktop). The hero is pure decoration — the form stays the focal point and is
 * fully functional. On small screens the layout collapses to a single column
 * and the hero is hidden, so the form takes full width and is never crowded.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Form panel — the real auth form (LoginPage / RegisterPage). */}
      <main className="relative flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <Reveal variant="fadeInUp" className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo className="h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>
          ) : null}
          <div className="mt-8">{children}</div>
          {footer ? (
            <div className="mt-6 text-center text-sm text-ink-muted">
              {footer}
            </div>
          ) : null}
        </Reveal>
      </main>

      {/* Branded hero panel (desktop only). */}
      <AuthHero />
    </div>
  );
}
