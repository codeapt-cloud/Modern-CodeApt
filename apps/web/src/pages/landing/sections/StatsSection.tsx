/**
 * Capability band — honest, non-fabricated framing. NO invented user counts or
 * testimonials: every figure is a true product capability (languages you can
 * run, cadence, cost). The one real number (languages) counts up on mount via
 * the shared useCountUp (reduced motion → shows the final value instantly).
 */
import { useCountUp } from "../../../lib/motion.js";
import { ScrollReveal } from "../motion/ScrollReveal.js";

interface Stat {
  /** Numeric → counts up; string → shown verbatim (e.g. "Daily", "Instant"). */
  value: number | string;
  suffix?: string;
  label: string;
}

const STATS: Stat[] = [
  { value: 4, label: "Languages you can run — Python, Java, C++, JS" },
  { value: "Daily", label: "New coding challenge, every single day" },
  { value: "Instant", label: "AI feedback on every essay you submit" },
  {
    value: 5,
    label: "Tools in one place — exams, challenges, essays, courses, careers",
  },
];

function StatValue({ value, suffix }: { value: number | string; suffix?: string }) {
  const isNum = typeof value === "number";
  const counted = useCountUp(isNum ? (value as number) : 0);
  return (
    <span className="text-4xl font-bold tracking-tight text-primary sm:text-5xl">
      {isNum ? counted : value}
      {suffix}
    </span>
  );
}

export function StatsSection() {
  return (
    <section
      aria-labelledby="stats-title"
      className="border-t border-subtle bg-surface py-16 sm:py-20"
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal className="text-center">
          <h2 id="stats-title" className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Impressive by design, not by hype
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-lg text-ink-secondary">
            No inflated numbers or borrowed logos — just practice on real,
            company-style assessment patterns.
          </p>
        </ScrollReveal>

        <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <ScrollReveal key={s.label} delay={i * 0.06} kind="up">
              <div className="flex h-full flex-col items-center rounded-2xl border border-subtle bg-surface-raised p-6 text-center shadow-sm">
                <StatValue value={s.value} suffix={s.suffix} />
                <p className="mt-3 text-sm text-ink-secondary">{s.label}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
