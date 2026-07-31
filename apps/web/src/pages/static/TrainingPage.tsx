/**
 * Training — programs / curriculum overview. In the original Django app this
 * page was DATA-DRIVEN and largely structural (no fixed marketing copy). We ship
 * the structure driven by a placeholder array so no program details are
 * fabricated; an honest empty-state renders while the array is empty.
 *
 * TODO: populate with real program/curriculum data.
 */
import { BookOpen } from "lucide-react";

import { Container } from "../../components/layout/Container.js";

interface Program {
  title: string;
  description: string;
  topics: string[];
}

// TODO: populate with real program/curriculum data (do NOT invent programs).
const programs: Program[] = [];

export function TrainingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="border-b border-subtle bg-surface-raised">
        <Container className="py-16 text-center">
          <p className="font-mono text-sm text-primary">{"{ }"}</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink">
            Training Programs
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-ink-secondary">
            Structured programs across Aptitude, Logical Reasoning, and Technical
            Coding — built for campus recruitment readiness.
          </p>
        </Container>
      </section>

      {/* Programs */}
      <Container size="lg" className="py-14">
        <h2 className="text-2xl font-bold tracking-tight text-ink">
          Our Programs
        </h2>
        {programs.length > 0 ? (
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {programs.map((program, i) => (
              <div
                key={i}
                className="rounded-2xl border border-subtle bg-surface-base p-6"
              >
                <h3 className="text-lg font-semibold text-ink">
                  {program.title}
                </h3>
                <p className="mt-1 text-sm text-ink-secondary">
                  {program.description}
                </p>
                {program.topics.length > 0 ? (
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {program.topics.map((topic, t) => (
                      <li
                        key={t}
                        className="rounded-full bg-surface-overlay px-3 py-1 text-xs text-ink-secondary"
                      >
                        {topic}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-subtle bg-surface-base py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-overlay text-ink-muted">
              <BookOpen className="h-6 w-6" />
            </span>
            <p className="max-w-sm text-sm text-ink-muted">
              Program details are being finalized and will appear here soon.
            </p>
          </div>
        )}
      </Container>
    </div>
  );
}
