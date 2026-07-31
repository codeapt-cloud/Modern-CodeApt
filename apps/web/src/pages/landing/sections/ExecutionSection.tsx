/**
 * "Real code execution" highlight — the moment that sets CodeApt apart. Benefit
 * copy on one side; a larger IDE-framed <CodeRunnerMock> (language tabs, run,
 * cascading test verdicts) on the other. Sits on a sunken surface with a cyan
 * glow so it reads as a distinct "spotlight" band in the scroll.
 */
import { Check } from "lucide-react";

import { ScrollReveal } from "../motion/ScrollReveal.js";
import { CodeRunnerMock, type CodeLine } from "../components/CodeRunnerMock.js";

const CODE: CodeLine[] = [
  [
    { t: "def ", k: "kw" },
    { t: "is_prime", k: "fn" },
    { t: "(n):", k: "txt" },
  ],
  [
    { t: "    if ", k: "kw" },
    { t: "n ", k: "txt" },
    { t: "< ", k: "op" },
    { t: "2", k: "num" },
    { t: ":", k: "txt" },
  ],
  [
    { t: "        return ", k: "kw" },
    { t: "False", k: "kw" },
  ],
  [
    { t: "    for ", k: "kw" },
    { t: "d ", k: "txt" },
    { t: "in ", k: "kw" },
    { t: "range", k: "fn" },
    { t: "(", k: "txt" },
    { t: "2", k: "num" },
    { t: ", ", k: "txt" },
    { t: "int", k: "fn" },
    { t: "(n**", k: "txt" },
    { t: "0.5", k: "num" },
    { t: ")+", k: "txt" },
    { t: "1", k: "num" },
    { t: "):", k: "txt" },
  ],
  [
    { t: "        if ", k: "kw" },
    { t: "n % d ", k: "txt" },
    { t: "== ", k: "op" },
    { t: "0", k: "num" },
    { t: ":", k: "txt" },
  ],
  [
    { t: "            return ", k: "kw" },
    { t: "False", k: "kw" },
  ],
  [
    { t: "    return ", k: "kw" },
    { t: "True", k: "kw" },
  ],
];

const TESTS = [
  "is_prime(2) → True",
  "is_prime(15) → False",
  "is_prime(97) → True",
  "guards n < 2",
  "1000003 · under 1s",
];

const POINTS = [
  "Multi-language: Python, Java, C++ and JavaScript",
  "Sample cases you can see, hidden cases that grade you",
  "Pass / fail verdicts and runtime in seconds",
  "Same engine across mock exams, daily challenges and the playground",
];

export function ExecutionSection() {
  return (
    <section
      id="execution"
      aria-labelledby="execution-title"
      className="relative scroll-mt-24 overflow-hidden border-t border-subtle bg-surface-sunken py-20 sm:py-28"
    >
      {/* Spotlight glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[40vh] w-[70vw] -translate-x-1/2 rounded-full bg-primary-500/10 blur-[120px]"
      />
      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <ScrollReveal>
          <span className="font-mono text-sm text-primary">
            {"{ real code execution }"}
          </span>
          <h2
            id="execution-title"
            className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl"
          >
            Real code. Real test cases.
            <br />
            Instant verdicts.
          </h2>
          <p className="mt-4 text-lg leading-8 text-ink-secondary">
            Write, run, and iterate right in the browser — the exact experience
            you’ll face in a real assessment, minus the setup and the fear of
            the unknown.
          </p>
          <ul className="mt-6 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm text-ink">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Check className="h-3.5 w-3.5" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </ScrollReveal>

        <ScrollReveal kind="scale" delay={0.08}>
          <CodeRunnerMock
            className="mx-auto max-w-lg"
            filename="solution.py"
            language="Python"
            tabs={["solution.py", "Main.java", "main.cpp", "index.js"]}
            lines={CODE}
            tests={TESTS}
          />
        </ScrollReveal>
      </div>
    </section>
  );
}
