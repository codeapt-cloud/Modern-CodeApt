/**
 * Landing header — a bespoke marketing top bar (distinct from PublicLayout's
 * header) that is transparent over the hero and fades in a glass background once
 * the visitor scrolls, for the cinematic full-bleed hero. Left: the {Code}Apt
 * wordmark. Center: in-page section anchors (desktop). Right: theme toggle +
 * Log in + Get started CTAs. Reuses ui/ primitives and tokens only.
 *
 * The scrolled state is a boolean toggled from scroll position (not an
 * animation), so it behaves identically under reduced motion — the bar simply
 * gains contrast for legibility as content scrolls beneath it.
 */
import { useMotionValueEvent, useScroll } from "framer-motion";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Logo } from "../../components/brand/Logo.js";
import { ThemeToggle } from "../../components/ThemeToggle.js";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/cn.js";

const sections = [
  { label: "Features", href: "#features" },
  { label: "Execution", href: "#execution" },
  { label: "Why CodeApt", href: "#audience" },
  { label: "About", href: "/about" },
];

export function LandingHeader() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => {
    setScrolled(v > 12);
  });

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-sticky transition-colors duration-slow ease-out",
        scrolled
          ? "border-b border-subtle bg-surface-raised/80 backdrop-blur"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="CodeApt home" className="shrink-0">
          <Logo className="h-7" />
        </Link>

        <nav
          aria-label="Landing sections"
          className="hidden items-center gap-1 md:flex"
        >
          {sections.map(({ label, href }) =>
            href.startsWith("#") ? (
              <a
                key={href}
                href={href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-overlay hover:text-ink"
              >
                {label}
              </a>
            ) : (
              <Link
                key={href}
                to={href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-overlay hover:text-ink"
              >
                {label}
              </Link>
            ),
          )}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/register">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
