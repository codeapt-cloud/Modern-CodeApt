/**
 * Site footer — carries the legal links (Terms / Privacy / Refund) a payment
 * product must keep reachable, plus the informational pages. Used by both the
 * public shell (PublicLayout) and the authenticated shell (AppShell), so these
 * links are reachable logged-out and logged-in. Token-styled; no Bootstrap.
 */
import { Link } from "react-router-dom";

import { Logo } from "../brand/Logo.js";

const company = [
  { label: "About", to: "/about" },
  { label: "Training", to: "/training" },
  { label: "Placements", to: "/placements" },
  { label: "Contact", to: "/contact" },
];

const legal = [
  { label: "Terms & Conditions", to: "/terms" },
  { label: "Privacy Policy", to: "/privacy" },
  { label: "Refund & Cancellation", to: "/refund-policy" },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-subtle bg-surface-raised">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <div className="space-y-3">
          <Link to="/" aria-label="CodeApt home" className="inline-block">
            <Logo className="h-7" />
          </Link>
          <p className="max-w-xs text-sm text-ink-muted">
            A dynamic learning hub for future professionals — Aptitude, Logical
            Reasoning, and Technical Coding in one curriculum.
          </p>
        </div>

        <div className="lg:col-start-3">
          <h2 className="mb-3 text-sm font-semibold text-ink">Company</h2>
          <ul className="space-y-2">
            {company.map(({ label, to }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="text-sm text-ink-secondary transition-colors hover:text-primary"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink">Legal</h2>
          <ul className="space-y-2">
            {legal.map(({ label, to }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="text-sm text-ink-secondary transition-colors hover:text-primary"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-subtle">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-ink-muted sm:flex-row sm:px-6 lg:px-8">
          <p className="font-mono">
            <span className="text-primary">{"{ }"}</span> CodeApt
          </p>
          <p>© {year} CODEAPT LLP. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
