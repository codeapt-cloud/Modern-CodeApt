/**
 * Feature showcase — the five things CodeApt actually does, each as a card with
 * a purpose-built mini-mock (not a stock icon), in a responsive bento grid.
 * Copy is real and benefit-led; visuals are decorative (aria-hidden) while the
 * heading + description carry the meaning. Cards reveal on scroll and lift on
 * hover (both reduced-motion / touch safe via the shared primitives).
 */
import {
  Award,
  Briefcase,
  Flame,
  GraduationCap,
  PenLine,
  Terminal,
} from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "../../../lib/cn.js";
import { HoverLift } from "../../../components/motion/HoverLift.js";
import { ScrollReveal } from "../motion/ScrollReveal.js";

/* ----------------------------- mini visuals ----------------------------- */

function Bar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-ink-muted">
        <span>{label}</span>
        <span className="font-mono">{pct}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-overlay">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ExamVisual() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-ink-secondary">Section 2 of 4</span>
        <span className="font-mono text-primary">28:15</span>
      </div>
      <div className="flex gap-1.5">
        {["primary", "primary", "active", "muted"].map((s, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              s === "primary" && "bg-primary",
              s === "active" && "bg-primary/50",
              s === "muted" && "bg-surface-overlay",
            )}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["Aptitude", "Reasoning", "Coding"].map((c) => (
          <span
            key={c}
            className="rounded-md bg-surface-overlay px-2 py-0.5 font-mono text-[11px] text-ink-secondary"
          >
            {c}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-subtle bg-surface-base/60 px-3 py-2">
        <Terminal className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[11px] text-ink-secondary">
          run · hidden + sample tests
        </span>
        <span className="ml-auto rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success-fg">
          Accepted
        </span>
      </div>
    </div>
  );
}

function DailyVisual() {
  const days = [1, 1, 1, 1, 1, 2, 0]; // 1 done, 2 today, 0 upcoming
  const board = [
    { r: 1, n: "asha_k", s: "980" },
    { r: 2, n: "you", s: "915" },
    { r: 3, n: "rahul.m", s: "902" },
  ];
  return (
    <div aria-hidden="true" className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
          <Flame className="h-3.5 w-3.5 text-warning-fg" /> 12-day streak
        </span>
        <span className="font-mono text-[11px] text-ink-muted">this week</span>
      </div>
      <div className="flex gap-1.5">
        {days.map((d, i) => (
          <span
            key={i}
            className={cn(
              "h-6 flex-1 rounded-md",
              d === 1 && "bg-primary/70",
              d === 2 && "bg-primary ring-2 ring-primary/40",
              d === 0 && "bg-surface-overlay",
            )}
          />
        ))}
      </div>
      <div className="space-y-1">
        {board.map((row) => (
          <div
            key={row.r}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1 text-[11px]",
              row.n === "you"
                ? "bg-primary/10 text-ink"
                : "text-ink-secondary",
            )}
          >
            <span className="font-mono text-ink-muted">#{row.r}</span>
            <span className="font-medium">{row.n}</span>
            <span className="ml-auto font-mono">{row.s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EssayVisual() {
  return (
    <div aria-hidden="true" className="flex items-center gap-4">
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-2 border-primary/40 bg-primary/10">
        <span className="text-xl font-bold text-primary">86</span>
        <span className="text-[9px] uppercase tracking-wide text-ink-muted">
          score
        </span>
      </div>
      <div className="flex-1 space-y-2">
        <Bar label="Structure" pct={88} />
        <Bar label="Vocabulary" pct={82} />
        <Bar label="Relevance" pct={90} />
      </div>
    </div>
  );
}

function CourseVisual() {
  const mods = [
    { t: "Arrays & Hashing", done: true },
    { t: "Two Pointers", done: true },
    { t: "Dynamic Programming", done: false },
  ];
  return (
    <div aria-hidden="true" className="space-y-3">
      <div className="space-y-1.5">
        {mods.map((m) => (
          <div key={m.t} className="flex items-center gap-2 text-xs">
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
                m.done
                  ? "bg-success/20 text-success-fg"
                  : "border border-strong text-ink-muted",
              )}
            >
              {m.done ? "✓" : ""}
            </span>
            <span className={m.done ? "text-ink-secondary" : "text-ink-muted"}>
              {m.t}
            </span>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
          <span>Progress</span>
          <span className="font-mono">62%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-overlay">
          <div className="h-full w-[62%] rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

function CareerVisual() {
  const jobs = [
    { role: "SDE Intern", org: "Product startup" },
    { role: "Graduate Engineer", org: "Services · TCS-style" },
  ];
  return (
    <div aria-hidden="true" className="space-y-2">
      {jobs.map((j) => (
        <div
          key={j.role}
          className="flex items-center gap-3 rounded-lg border border-subtle bg-surface-base/60 px-3 py-2"
        >
          <div className="flex-1">
            <p className="text-xs font-semibold text-ink">{j.role}</p>
            <p className="text-[11px] text-ink-muted">{j.org}</p>
          </div>
          <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-ink-inverse">
            Apply
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- features ------------------------------- */

interface Feature {
  icon: typeof Terminal;
  eyebrow: string;
  title: string;
  body: string;
  visual: ReactNode;
  wide?: boolean;
}

const FEATURES: Feature[] = [
  {
    icon: Terminal,
    eyebrow: "Mock placement exams",
    title: "Sit the real thing, before it counts",
    body: "Timed, sectioned assessments with genuine in-browser code execution and real test cases — modelled on TCS NQT and company-style patterns. No installs, no setup.",
    visual: <ExamVisual />,
    wide: true,
  },
  {
    icon: Flame,
    eyebrow: "Daily challenges",
    title: "Show up every day",
    body: "A fresh problem daily, streaks that keep you honest, a live leaderboard, and a full playground to experiment.",
    visual: <DailyVisual />,
  },
  {
    icon: PenLine,
    eyebrow: "AI-graded essays",
    title: "Write like you'll be hired",
    body: "Instant, dimensioned feedback on structure, vocabulary and relevance — so communication rounds stop being a surprise.",
    visual: <EssayVisual />,
  },
  {
    icon: GraduationCap,
    eyebrow: "Structured courses",
    title: "Learn it properly, once",
    body: "Video, text and quizzes with progress tracking across Aptitude, Reasoning and Coding.",
    visual: <CourseVisual />,
  },
  {
    icon: Briefcase,
    eyebrow: "Careers board",
    title: "From practice to placed",
    body: "Real openings and a one-tap apply flow, so the work you put in has somewhere to go.",
    visual: <CareerVisual />,
  },
];

export function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="scroll-mt-24 border-t border-subtle bg-surface py-20 sm:py-28"
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal className="max-w-2xl">
          <span className="flex items-center gap-2 font-mono text-sm text-primary">
            <Award className="h-4 w-4" /> {"{ what you can do }"}
          </span>
          <h2
            id="features-title"
            className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl"
          >
            One platform for the whole placement gauntlet
          </h2>
          <p className="mt-3 text-lg text-ink-secondary">
            Everything you need to go from “still learning” to “offer in hand” —
            and it all shares one clean, distraction-free workspace.
          </p>
        </ScrollReveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <ScrollReveal
              key={f.eyebrow}
              delay={(i % 3) * 0.06}
              className={cn(f.wide && "sm:col-span-2")}
            >
              <HoverLift className="h-full">
                <article className="flex h-full flex-col rounded-2xl border border-subtle bg-surface-raised p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <f.icon className="h-5 w-5" />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {f.eyebrow}
                    </span>
                  </div>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight text-ink">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-ink-secondary">
                    {f.body}
                  </p>
                  <div className="mt-6 rounded-xl border border-subtle bg-surface-base/60 p-4">
                    {f.visual}
                  </div>
                </article>
              </HoverLift>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
