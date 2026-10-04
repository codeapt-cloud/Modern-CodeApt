/**
 * GuideSteps (Step 41) — renders structured how-to guidance as a CHECKLIST, not
 * prose. Each step is a numbered row with a tick checkbox, the instruction, an
 * optional in-app deep link (navigates in the same tab so the panel stays put),
 * the literal control label as a chip, and visually-distinct prerequisite / gotcha
 * callouts. Pure/props-driven so it's directly testable.
 */
import type { AdminGuideStep } from "@codeapt/shared";

export interface GuideStepsProps {
  steps: AdminGuideStep[];
  checked: boolean[];
  onToggle: (index: number) => void;
  /** Current college slug, to resolve :collegeSlug/:slug in a step's route. */
  slug?: string;
  /** In-app navigation (same tab). Omitted in tests → links render but no-op. */
  onNavigate?: (path: string) => void;
}

/** Resolve a map route to a concrete in-app path, or null if it still has params. */
function resolveHref(route: string, slug?: string): string | null {
  const path = route
    .replace(/:collegeSlug/g, slug ?? "")
    .replace(/:slug/g, slug ?? "");
  return path.includes(":") || path.includes("//") ? null : path;
}

export function GuideSteps({ steps, checked, onToggle, slug, onNavigate }: GuideStepsProps) {
  return (
    <ol data-testid="guide-steps" className="flex flex-col gap-2">
      {steps.map((step, i) => {
        const href = step.route ? resolveHref(step.route, slug) : null;
        const done = checked[i] ?? false;
        return (
          <li
            key={i}
            className="rounded-lg border border-subtle bg-surface-base p-2.5 text-sm"
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                data-testid={`guide-check-${i}`}
                checked={done}
                onChange={() => onToggle(i)}
                aria-label={`Step ${i + 1} done`}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <div className="flex-1">
                <p className={done ? "text-ink-muted line-through" : "text-ink"}>
                  <span className="mr-1 font-mono text-xs text-ink-muted">{i + 1}.</span>
                  {step.text}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {step.control ? (
                    <span
                      data-testid={`guide-control-${i}`}
                      className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
                    >
                      {step.control}
                    </span>
                  ) : null}
                  {step.route ? (
                    href && onNavigate ? (
                      <button
                        type="button"
                        data-testid={`guide-link-${i}`}
                        onClick={() => onNavigate(href)}
                        className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
                      >
                        Take me there →
                      </button>
                    ) : (
                      <span className="font-mono text-[11px] text-ink-muted">
                        {step.route}
                      </span>
                    )
                  ) : null}
                </div>
                {step.prerequisite ? (
                  <p
                    data-testid={`guide-prereq-${i}`}
                    className="mt-1 rounded border border-warning-subtle bg-warning-subtle/30 px-2 py-1 text-xs text-warning-fg"
                  >
                    Prerequisite: {step.prerequisite}
                  </p>
                ) : null}
                {step.gotcha ? (
                  <p
                    data-testid={`guide-gotcha-${i}`}
                    className="mt-1 text-xs text-ink-muted"
                  >
                    ⚠ {step.gotcha}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
