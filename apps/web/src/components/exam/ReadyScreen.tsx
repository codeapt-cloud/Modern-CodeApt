/**
 * Pre-exam "ready" screen — explains the rules (timed sections, fullscreen /
 * tab-switch warnings) before the attempt starts. The action slot holds the
 * Begin button (logged-in) or the roll/college entry form (public).
 */
import { AlertTriangle, Clock, ListChecks, Maximize } from "lucide-react";
import type { ReactNode } from "react";

import { EXAM_MAX_WARNINGS } from "@codeapt/shared";

import { Reveal } from "../motion/index.js";
import { Card, CardContent } from "../ui/card.js";

export function ReadyScreen({
  title,
  meta,
  action,
}: {
  title: string;
  meta: {
    sectionCount: number;
    totalDurationMinutes: number;
    totalMarks: number;
    passPercentage: number;
  };
  action: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
      <Reveal variant="fadeInUp" className="mb-6 text-center">
        <p className="font-mono text-3xl text-primary">{"{ }"}</p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Read the rules below, then begin when you’re ready.
        </p>
      </Reveal>

      <Reveal variant="fadeInUp" delay={0.08}>
      <Card>
        <CardContent className="space-y-5 p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              icon={<ListChecks className="h-4 w-4" />}
              label="Sections"
              value={String(meta.sectionCount)}
            />
            <Stat
              icon={<Clock className="h-4 w-4" />}
              label="Duration"
              value={`${meta.totalDurationMinutes} min`}
            />
            <Stat
              icon={<span className="font-mono text-sm">Σ</span>}
              label="Total marks"
              value={String(meta.totalMarks)}
            />
            <Stat
              icon={<span className="font-mono text-sm">%</span>}
              label="Pass mark"
              value={`${meta.passPercentage}%`}
            />
          </div>

          <ul className="space-y-2 rounded-xl border border-subtle bg-surface-base p-4 text-sm text-ink-muted">
            <Rule icon={<Clock className="h-4 w-4 text-primary" />}>
              Each section is <span className="text-ink">separately timed</span>
              . When a section’s time runs out it submits automatically and you
              can’t return to it.
            </Rule>
            <Rule icon={<Maximize className="h-4 w-4 text-primary" />}>
              The exam runs in <span className="text-ink">fullscreen</span>.
            </Rule>
            <Rule icon={<AlertTriangle className="h-4 w-4 text-warning-fg" />}>
              Leaving fullscreen or switching tabs triggers a{" "}
              <span className="text-ink">warning</span>. More than{" "}
              <span className="text-ink">{EXAM_MAX_WARNINGS}</span> warnings
              flags your attempt for review.
            </Rule>
          </ul>

          <div className="flex justify-center pt-1">{action}</div>
        </CardContent>
      </Card>
      </Reveal>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-subtle bg-surface-base p-3 text-center">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
        {icon}
      </span>
      <span className="font-mono text-sm font-semibold text-ink">{value}</span>
      <span className="text-xs text-ink-muted">{label}</span>
    </div>
  );
}

function Rule({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </li>
  );
}
