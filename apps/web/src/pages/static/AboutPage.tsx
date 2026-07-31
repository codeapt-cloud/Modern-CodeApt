/**
 * About Us — verbatim copy from the original CodeApt template, re-expressed in
 * our design system (no Bootstrap). Reduced-motion-safe (no entrance animation).
 */
import { Container } from "../../components/layout/Container.js";

const steps = [
  {
    n: "1",
    title: "Concepts",
    body: "In-depth explanation with real-world examples.",
  },
  {
    n: "2",
    title: "Practice",
    body: "Rigorous daily practice sets to reinforce learning.",
  },
  {
    n: "3",
    title: "Mock Tests",
    body: "Tests following TCS & Infosys patterns.",
  },
  {
    n: "4",
    title: "Simulations",
    body: "Mock Technical and HR interviews.",
  },
];

export function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section className="border-b border-subtle bg-surface-raised">
        <Container className="py-16 text-center">
          <p className="font-mono text-sm text-primary">{"{ }"}</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink">
            About CodeApt
          </h1>
          <p className="mt-3 text-lg text-ink-secondary">
            A Dynamic Learning Hub for Future Professionals
          </p>
        </Container>
      </section>

      {/* Our Mission */}
      <Container size="lg" className="py-14">
        <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight text-ink">
              Our Mission
            </h2>
            <p className="text-lg font-medium text-primary">
              Bridging the gap between academic learning and industry
              requirements.
            </p>
            <p className="leading-7 text-ink-secondary">
              CodeApt is established in Nagole, Hyderabad, with a clear mission:
              to transform students into highly skilled professionals. We blend
              Aptitude, Logical Reasoning, and Technical Coding into a single
              powerful curriculum.
            </p>
          </div>
          <div className="flex items-center justify-center rounded-2xl border border-subtle bg-surface-base p-8 text-center">
            <div className="font-mono">
              <p className="text-2xl font-bold text-ink">
                Code <span className="text-primary">+</span> Apt
              </p>
              <p className="mt-1 text-sm text-ink-muted">Skill + Talent</p>
            </div>
          </div>
        </div>
      </Container>

      {/* How We Train */}
      <section className="border-t border-subtle bg-surface-raised">
        <Container size="lg" className="py-14">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight text-ink">
              How We Train
            </h2>
            <p className="mt-2 text-ink-muted">
              A structured approach to ensure placement success
            </p>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <div
                key={s.n}
                className="rounded-2xl border border-subtle bg-surface-base p-6"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 font-mono text-lg font-bold text-primary">
                  {s.n}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-ink">
                  {s.title}
                </h3>
                <p className="mt-1 text-sm text-ink-secondary">{s.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Director quote */}
      <Container size="md" className="py-14">
        <blockquote className="rounded-2xl border-l-4 border-primary bg-surface-base p-8">
          <p className="text-lg italic leading-8 text-ink">
            “We are committed to delivering measurable improvement in student
            performance and ensuring placement outcomes strengthen year after
            year.”
          </p>
          <footer className="mt-4 not-italic">
            <p className="font-semibold text-ink">Hemanth J</p>
            <p className="text-sm text-ink-muted">Director, CodeApt LLP</p>
          </footer>
        </blockquote>
      </Container>
    </div>
  );
}
