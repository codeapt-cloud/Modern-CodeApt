/**
 * Final CTA — the closing push. A cyan-glowing glass band with the primary
 * "Get started" (→ /register) and secondary "Log in" (→ /login). Decorative
 * glow is aria-hidden; the heading + buttons carry all meaning.
 */
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { BraceMotif } from "../../../components/brand/BraceMotif.js";
import { Button } from "../../../components/ui/button.js";
import { ScrollReveal } from "../motion/ScrollReveal.js";

export function FinalCtaSection() {
  return (
    <section
      aria-labelledby="cta-title"
      className="border-t border-subtle bg-surface py-20 sm:py-28"
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal kind="scale">
          <div className="relative isolate overflow-hidden rounded-3xl border border-subtle bg-surface-raised px-6 py-16 text-center shadow-lg sm:px-12">
            {/* Glow */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 bg-grid-glow"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-0 -z-10 h-64 w-[80%] -translate-x-1/2 rounded-full bg-primary-500/15 blur-[100px]"
            />

            <div className="flex justify-center">
              <BraceMotif size="text-4xl" />
            </div>
            <h2
              id="cta-title"
              className="mx-auto mt-4 max-w-2xl text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              Your next offer is a few problems away
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-ink-secondary">
              Create your account and take your first mock assessment today —
              real code, real test cases, real practice.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/register">
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/login">Log in</Link>
              </Button>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
