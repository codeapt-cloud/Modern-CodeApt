/**
 * "Who it's for / why CodeApt" — the trust section. Honest positioning (make
 * the real assessment experience familiar before the day that counts) and real
 * company truth (CODEAPT LLP, Nagole · Hyderabad; Aptitude + Reasoning + Coding
 * in one curriculum). No price/"free" claims — CodeApt is a paid product — and
 * no fabricated numbers; each point is a truthful commitment.
 */
import { Layers, ShieldCheck, Target } from "lucide-react";

import { ScrollReveal } from "../motion/ScrollReveal.js";

const PROMISES = [
  {
    icon: Layers,
    title: "Everything in one workspace",
    body: "Mock exams, daily challenges, AI-graded essays, courses and a careers board — one login, one clean workspace, no juggling half a dozen tools.",
  },
  {
    icon: Target,
    title: "Real patterns, not fluff",
    body: "Assessments modelled on TCS NQT and company formats — the actual shapes you’ll face, not generic quiz filler.",
  },
  {
    icon: ShieldCheck,
    title: "Progress you can trust",
    body: "Honest scoring and tracked progress. AI feedback is advisory and transparent — never an unexplained black-box grade.",
  },
];

export function AudienceSection() {
  return (
    <section
      id="audience"
      aria-labelledby="audience-title"
      className="scroll-mt-24 border-t border-subtle bg-surface-sunken py-20 sm:py-28"
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center">
          <ScrollReveal>
            <span className="font-mono text-sm text-primary">
              {"{ why CodeApt }"}
            </span>
            <h2
              id="audience-title"
              className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              Make the real thing familiar before it counts
            </h2>
            <p className="mt-4 text-lg leading-8 text-ink-secondary">
              Placement rounds are unforgiving and unfamiliar. CodeApt closes
              that gap — the same assessment formats, the same clock, the same
              feedback loop — so on the day itself nothing catches you off
              guard. Practice the reps until they feel routine.
            </p>

            {/* Brand motif — mirrors the About page's Code + Apt device. */}
            <div className="mt-8 inline-flex items-center gap-4 rounded-2xl border border-subtle bg-surface-raised px-6 py-4 shadow-sm">
              <p className="font-mono text-lg font-bold text-ink">
                Code <span className="text-primary">+</span> Apt
              </p>
              <span className="h-8 w-px border-l border-strong" />
              <div className="text-sm">
                <p className="font-medium text-ink">Skill + Talent</p>
                <p className="text-ink-muted">
                  By CODEAPT LLP · Nagole, Hyderabad
                </p>
              </div>
            </div>
          </ScrollReveal>

          <div className="space-y-4">
            {PROMISES.map((p, i) => (
              <ScrollReveal key={p.title} delay={i * 0.06}>
                <div className="flex gap-4 rounded-2xl border border-subtle bg-surface-raised p-5 shadow-sm">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <p.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-ink">
                      {p.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-ink-secondary">
                      {p.body}
                    </p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
