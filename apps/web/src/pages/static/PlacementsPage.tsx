/**
 * Placements — "Proven Impact". In the original Django app this page was
 * DATA-DRIVEN: success stories and academic partners were passed in from the
 * view. We ship the correct STRUCTURE and the real hero copy, but drive it from
 * placeholder arrays so no placement stats or partner colleges are fabricated.
 * When the arrays are empty the page renders an honest empty-state.
 *
 * TODO: populate with real placement stats + partner colleges.
 */
import { Building2, GraduationCap } from "lucide-react";

import { Container } from "../../components/layout/Container.js";

interface SuccessStory {
  company: string;
  count: string;
  college: string;
  subtext: string;
}

// TODO: populate with real placement stats (do NOT invent company names/counts).
const successStories: SuccessStory[] = [];

// TODO: populate with real partner college names.
const partners: string[] = [];

export function PlacementsPage() {
  return (
    <div>
      {/* Hero */}
      <section className="border-b border-subtle bg-surface-raised">
        <Container className="py-16 text-center">
          <p className="font-mono text-sm text-primary">{"{ }"}</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink">
            Proven Impact
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-ink-secondary">
            Our results speak louder than words. We specialize in transforming
            entire batches into placement-ready professionals.
          </p>
        </Container>
      </section>

      {/* Success stories */}
      <Container size="lg" className="py-14">
        <h2 className="text-2xl font-bold tracking-tight text-ink">
          Success Stories
        </h2>
        {successStories.length > 0 ? (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {successStories.map((story, i) => (
              <div
                key={i}
                className="rounded-2xl border border-subtle bg-surface-base p-6"
              >
                <p className="font-mono text-3xl font-bold text-primary">
                  {story.count}
                </p>
                <p className="mt-2 text-lg font-semibold text-ink">
                  {story.company}
                </p>
                <p className="text-sm text-ink-secondary">{story.college}</p>
                <p className="mt-2 text-sm text-ink-muted">{story.subtext}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            message="Placement highlights are being compiled and will appear here soon."
          />
        )}
      </Container>

      {/* Academic partners */}
      <section className="border-t border-subtle bg-surface-raised">
        <Container size="lg" className="py-14">
          <h2 className="text-2xl font-bold tracking-tight text-ink">
            Our Academic Partners
          </h2>
          {partners.length > 0 ? (
            <div className="mt-8 flex flex-wrap gap-3">
              {partners.map((name, i) => (
                <span
                  key={i}
                  className="rounded-full border border-subtle bg-surface-base px-4 py-2 text-sm text-ink"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<GraduationCap className="h-6 w-6" />}
              message="Partner colleges will be listed here soon."
            />
          )}
        </Container>
      </section>
    </div>
  );
}

function EmptyState({
  icon,
  message,
}: {
  icon: React.ReactNode;
  message: string;
}) {
  return (
    <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-subtle bg-surface-base py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-overlay text-ink-muted">
        {icon}
      </span>
      <p className="max-w-sm text-sm text-ink-muted">{message}</p>
    </div>
  );
}
