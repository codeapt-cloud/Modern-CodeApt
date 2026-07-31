/**
 * 404 — the one low-stakes surface where a bit more personality is welcome.
 * The brand brace motif frames "404" with a one-shot scale/settle on mount and
 * a gentle idle float (idle loop allowed here ONLY when motion is permitted).
 * Reduced motion → static, final state, fully usable.
 */
import { motion, useReducedMotion } from "framer-motion";
import { Link } from "react-router-dom";

import { BraceMotif } from "../components/brand/BraceMotif.js";
import { Button } from "../components/ui/button.js";
import { springSoft } from "../lib/motion.js";

export function NotFoundPage() {
  const reduced = useReducedMotion();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface bg-grid-glow px-4 text-center">
      <motion.div
        aria-hidden="true"
        initial={reduced ? false : { scale: 0.7, opacity: 0 }}
        animate={reduced ? undefined : { scale: 1, opacity: 1 }}
        transition={springSoft}
      >
        <motion.div
          animate={reduced ? undefined : { y: [0, -6, 0] }}
          transition={
            reduced
              ? undefined
              : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }
          }
        >
          <BraceMotif size="text-7xl" className="justify-center">
            <span className="font-mono text-6xl font-bold text-ink">404</span>
          </BraceMotif>
        </motion.div>
      </motion.div>

      <h1 className="text-2xl font-bold text-ink">Page not found</h1>
      <p className="max-w-sm text-ink-muted">
        The page you’re looking for doesn’t exist or has moved.
      </p>
      <Button asChild>
        <Link to="/app">Back to dashboard</Link>
      </Button>
    </div>
  );
}
