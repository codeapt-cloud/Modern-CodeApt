/**
 * Per-college BRANDED login page (route: /c/:collegeSlug/login, guest-only).
 *
 * A branded SKIN over the EXISTING auth: it fetches the college's PUBLIC branding
 * by slug (pre-auth) and renders the SAME <LoginForm/> — identical credentials,
 * submit, and post-login redirect (RootRoute + homePathForUser route each user
 * to their correct home, unchanged). Only the surrounding chrome changes.
 *
 * It reuses the SAME animated split layout as the global /login: the form on the
 * left, an animated WebGL hero on the right (<BrandedAuthHero>), recolored to the
 * college's accent color and carrying the college's logo/name/welcome. On mobile
 * the hero collapses away and a compact brand header + footer stand in.
 *
 * Graceful by design: branding unset → clean default (college name + brand
 * styling); unknown slug → a "college not found" card linking to the generic
 * /login. The generic /login is untouched.
 */
import { type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { Logo } from "../../components/brand/Logo.js";
import { Reveal } from "../../components/motion/index.js";
import { ThemeToggle } from "../../components/ThemeToggle.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { imageUrl } from "../../lib/cloudinary.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { BrandedAuthHero } from "./BrandedAuthHero.js";
import { LoginForm } from "./LoginForm.js";

/** Centered single-column shell for the loading + not-found states. */
function CenteredShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-base">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Reveal variant="fadeInUp" className="w-full max-w-md">
          {children}
        </Reveal>
      </main>
      <footer className="shrink-0 border-t border-subtle py-4 text-center text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          Supported by <Logo className="h-4" />
        </span>
      </footer>
    </div>
  );
}

export function BrandedLoginPage() {
  const { collegeSlug = "" } = useParams();
  const brandingQuery = useQuery(
    () => api.public.collegeBranding(collegeSlug),
    [collegeSlug],
  );

  if (brandingQuery.loading) {
    return (
      <CenteredShell>
        <div className="space-y-6 rounded-2xl border border-subtle bg-surface-raised p-8">
          <Skeleton className="mx-auto h-14 w-14 rounded-2xl" />
          <Skeleton className="mx-auto h-6 w-40" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </CenteredShell>
    );
  }

  if (brandingQuery.error || !brandingQuery.data) {
    return (
      <CenteredShell>
        <div className="rounded-2xl border border-subtle bg-surface-raised p-8 text-center">
          <h1 className="text-xl font-bold text-ink">College not found</h1>
          <p className="mt-2 text-sm text-ink-muted">
            We couldn&apos;t find a college for this link. Check the URL, or use
            the standard login.
          </p>
          <Button asChild className="mt-6">
            <Link to="/login">Go to login</Link>
          </Button>
        </div>
      </CenteredShell>
    );
  }

  const b = brandingQuery.data;
  const accent = b.brandColor || undefined;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Form panel — the real auth form. */}
      <main className="relative flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <Reveal variant="fadeInUp" className="w-full max-w-md">
          {/* Brand header (compact; carries the branding on mobile where the
              hero is hidden, and complements it on desktop). */}
          <div className="mb-8 flex flex-col items-center text-center">
            {b.logoUrl ? (
              <img
                src={imageUrl(b.logoUrl)}
                alt={`${b.displayName} logo`}
                className="mb-4 h-16 max-w-[220px] object-contain"
              />
            ) : (
              <div
                className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold text-white"
                style={{
                  backgroundColor: accent ?? "rgb(var(--color-primary-500))",
                }}
                aria-hidden
              >
                {b.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              {b.displayName}
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {b.welcomeText || "Log in to continue."}
            </p>
          </div>

          {/* The EXACT same login form + auth + post-login redirect. */}
          <LoginForm />

          {/* Fixed attribution — always present (hero carries it on desktop). */}
          <div className="mt-8 text-center lg:hidden">
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              Supported by <Logo className="h-4" />
            </span>
          </div>
        </Reveal>
      </main>

      {/* Branded animated hero (desktop only). */}
      <BrandedAuthHero
        accent={accent}
        logoUrl={b.logoUrl || undefined}
        displayName={b.displayName}
        welcomeText={b.welcomeText || undefined}
      />
    </div>
  );
}
