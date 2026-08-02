/**
 * Hero — the landing's first impression. One striking idea, executed cleanly:
 * an ambient cyan aurora (lazy WebGL, static fallback) behind a glassy,
 * pointer-tilted "mock assessment" card that types code, runs it, and passes
 * its tests. Headline + subhead + primary/secondary CTAs sit to the left.
 *
 * Depth: stacked translucent panels behind the card + a subtle parallax drift
 * + a ±5° pointer tilt (desktop, fine pointer, motion allowed only). Floating
 * "streak" and "accepted" chips add a beat of product delight.
 *
 * Motion budget: hero entrance uses the shared <Reveal> (on-mount, once). Tilt
 * and parallax are disabled on touch and under reduced motion — the hero is
 * fully legible and complete when still.
 */
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { type PointerEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "../../../components/ui/button.js";
import { Reveal } from "../../../components/motion/Reveal.js";
import { useCoarsePointer } from "../../../lib/motion.js";
import { ParallaxLayer } from "../motion/ParallaxLayer.js";
import { CodeRunnerMock, type CodeLine } from "../components/CodeRunnerMock.js";
import { HeroBackdrop } from "../components/HeroBackdrop.js";

// Tiny hand-tokenised two-sum snippet for the mock editor.
const HERO_CODE: CodeLine[] = [
  [
    { t: "def ", k: "kw" },
    { t: "two_sum", k: "fn" },
    { t: "(nums, target):", k: "txt" },
  ],
  [
    { t: "    seen ", k: "txt" },
    { t: "= ", k: "op" },
    { t: "{}", k: "txt" },
  ],
  [
    { t: "    for ", k: "kw" },
    { t: "i, n ", k: "txt" },
    { t: "in ", k: "kw" },
    { t: "enumerate", k: "fn" },
    { t: "(nums):", k: "txt" },
  ],
  [
    { t: "        if ", k: "kw" },
    { t: "target ", k: "txt" },
    { t: "- ", k: "op" },
    { t: "n ", k: "txt" },
    { t: "in ", k: "kw" },
    { t: "seen:", k: "txt" },
  ],
  [
    { t: "            return ", k: "kw" },
    { t: "[seen[target - n], i]", k: "txt" },
  ],
  [
    { t: "        seen[n] ", k: "txt" },
    { t: "= ", k: "op" },
    { t: "i", k: "txt" },
  ],
];

const HERO_TESTS = [
  "nums=[2,7,11,15], target=9",
  "nums=[3,2,4], target=6",
  "handles duplicate values",
  "large input · under 1s",
];

/** Desktop pointer-tilt wrapper — no-op on touch / reduced motion. */
function TiltCard({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const coarse = useCoarsePointer();
  const enabled = !reduced && !coarse;

  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [6, -6]), {
    stiffness: 150,
    damping: 18,
  });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-6, 6]), {
    stiffness: 150,
    damping: 18,
  });

  if (!enabled) return <div className="relative">{children}</div>;

  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width - 0.5);
    py.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const onLeave = (): void => {
    px.set(0);
    py.set(0);
  };

  return (
    <motion.div
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={{ rotateX, rotateY, transformPerspective: 1200 }}
      className="relative [transform-style:preserve-3d]"
    >
      {children}
    </motion.div>
  );
}

export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBackdrop />

      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-4 pb-20 pt-28 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-8 lg:pb-28 lg:pt-36">
        {/* Copy column */}
        <div className="max-w-xl">
          <Reveal variant="fadeInUp">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Real in-browser code execution · Company-style patterns
            </span>
          </Reveal>

          <Reveal variant="fadeInUp" delay={0.06}>
            <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              Crack your placements.
              <br />
              <span className="text-primary">Practice the real thing.</span>
            </h1>
          </Reveal>

          <Reveal variant="fadeInUp" delay={0.12}>
            <p className="mt-5 text-lg leading-8 text-ink-secondary">
              CodeApt turns placement prep into the actual experience — timed
              mock assessments with real code execution, daily coding
              challenges, AI-graded writing, and structured courses. The real
              practice, all in one place.
            </p>
          </Reveal>

          <Reveal variant="fadeInUp" delay={0.18}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/register">
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/login">Log in</Link>
              </Button>
              <a
                href="#features"
                className="ml-1 text-sm font-medium text-ink-muted underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                See how it works ↓
              </a>
            </div>
          </Reveal>

          <Reveal variant="fadeIn" delay={0.26}>
            <p className="mt-6 font-mono text-xs text-ink-muted">
              {"// practice the patterns real companies actually use"}
            </p>
          </Reveal>
        </div>

        {/* Visual column */}
        <Reveal variant="scaleIn" delay={0.15} className="relative min-w-0 w-full">
          <ParallaxLayer speed={-0.06}>
            <div className="relative mx-auto max-w-md w-full min-w-0 lg:mr-0">
              {/* Depth: stacked translucent panels behind the card. */}
              <div
                aria-hidden="true"
                className="glass absolute -inset-x-6 -top-6 bottom-10 -z-10 rounded-3xl opacity-40"
              />
              <div
                aria-hidden="true"
                className="glass absolute -inset-x-3 -top-3 bottom-6 -z-10 rounded-3xl opacity-70"
              />

              <TiltCard>
                <CodeRunnerMock
                  filename="two_sum.py"
                  language="Python"
                  topBar={{ label: "Mock Assessment · Coding", meta: "28:15" }}
                  lines={HERO_CODE}
                  tests={HERO_TESTS}
                />

                {/* Floating delight chips */}
                <div
                  aria-hidden="true"
                  className="glass absolute -left-4 -top-4 hidden sm:flex items-center gap-2 rounded-xl px-3 py-2 shadow-md"
                >
                  <span className="text-base">🔥</span>
                  <span className="text-xs font-semibold text-ink">
                    7-day streak
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  className="glass absolute -bottom-4 -right-3 hidden sm:flex items-center gap-2 rounded-xl px-3 py-2 shadow-md"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/20 text-success-fg">
                    ✓
                  </span>
                  <span className="text-xs font-semibold text-ink">
                    All tests passed
                  </span>
                </div>
              </TiltCard>
            </div>
          </ParallaxLayer>
        </Reveal>
      </div>
    </section>
  );
}
