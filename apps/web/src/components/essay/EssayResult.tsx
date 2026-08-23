/**
 * Essay results view. Renders an EssayGradingResult: the total prominently, a
 * per-dimension breakdown (all 7 sub-scores with a bar) annotated with each
 * dimension's WEIGHT from ESSAY_SCORE_WEIGHTS so the vocabulary/structure/
 * relevance emphasis is legible, the feedback text, word count, and a source
 * badge. Both feedback styles (AI prose vs synthesized-from-subscores) render
 * the same way — plain text, never HTML.
 *
 * Moment animation (Step-1 primitives): the total counts up 0→final, then the
 * dimension bars stagger in and fill. This is a graded result someone's anxious
 * about — the beat is calm and affirming, not flashy. Reduced motion → final
 * number and full bars instantly.
 */
import {
  EMAIL_SCORE_WEIGHTS,
  ESSAY_SCORE_WEIGHTS,
  EssayScoreSource,
  type EmailDimensionScoresDto,
  type EmailScoreDimension,
  type EssayAiFeedbackResponse,
  type EssayDimensionScoresDto,
  type EssayGradingResult,
  type EssayScoreDimension,
} from "@codeapt/shared";
import { motion, useReducedMotion } from "framer-motion";
import { RotateCcw, ShieldAlert } from "lucide-react";

import { DURATION, EASING, useCountUp } from "../../lib/motion.js";
import { Stagger, StaggerItem } from "../motion/index.js";
import { Button } from "../ui/button.js";
import { EssayAiFeedbackPanel } from "./EssayAiFeedbackPanel.js";
import { SourceBadge } from "./EssayBadges.js";

/** Human labels for the advisory integrity flags (essay-integrity.ts slugs). */
const INTEGRITY_FLAG_LABEL: Record<string, string> = {
  "burst-insert": "Large text inserted without matching keystrokes",
  "fast-typing": "Text entered faster than typical typing",
  "blocked-paste": "Paste attempt (blocked)",
};

const DIMENSION_LABEL: Record<EssayScoreDimension, string> = {
  vocabulary: "Vocabulary",
  structure: "Structure",
  relevance: "Relevance",
  grammar: "Grammar",
  readability: "Readability",
  punctuation: "Punctuation",
  spelling: "Spelling",
};

/** Email rubric labels (Communication module). */
const EMAIL_DIMENSION_LABEL: Record<EmailScoreDimension, string> = {
  content: "Content (scenario + CTA)",
  format: "Format (subject/greeting/sign-off)",
  tone: "Tone",
  register: "Register (formality)",
  grammar: "Grammar",
  readability: "Readability",
  punctuation: "Punctuation",
  spelling: "Spelling",
};
const EMAIL_ORDER = (
  Object.keys(EMAIL_SCORE_WEIGHTS) as EmailScoreDimension[]
).sort((a, b) => EMAIL_SCORE_WEIGHTS[b] - EMAIL_SCORE_WEIGHTS[a]);

// Highest-weight dimensions first, so the emphasis is visually obvious.
const ORDER = (Object.keys(ESSAY_SCORE_WEIGHTS) as EssayScoreDimension[]).sort(
  (a, b) => ESSAY_SCORE_WEIGHTS[b] - ESSAY_SCORE_WEIGHTS[a],
);

function barColor(score: number): string {
  if (score >= 80) return "bg-success";
  if (score >= 50) return "bg-primary";
  if (score >= 30) return "bg-warning";
  return "bg-error";
}

function DimensionRow({
  dim,
  score,
  reduced,
}: {
  dim: EssayScoreDimension;
  score: number;
  reduced: boolean;
}) {
  const weightPct = Math.round(ESSAY_SCORE_WEIGHTS[dim] * 100);
  const pct = Math.min(100, Math.max(0, score));
  return (
    <div className="grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink">{DIMENSION_LABEL[dim]}</span>
        <span
          className="rounded bg-surface-overlay px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
          title={`Weight: ${weightPct}% of the total`}
        >
          {weightPct}%
        </span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={Math.round(score)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={DIMENSION_LABEL[dim]}
      >
        {reduced ? (
          <div
            className={`h-full rounded-full ${barColor(score)}`}
            style={{ width: `${pct}%` }}
          />
        ) : (
          // Width fills via the shared stagger's "hidden"→"visible" state,
          // inherited from the <Stagger> container, so bars cascade in.
          <motion.div
            className={`h-full rounded-full ${barColor(score)}`}
            variants={{ hidden: { width: "0%" }, visible: { width: `${pct}%` } }}
            transition={{ duration: DURATION.slow, ease: EASING.standard }}
          />
        )}
      </div>
      <span className="text-right font-mono text-sm text-ink">
        {score.toFixed(0)}
      </span>
    </div>
  );
}

export function EssayResult({
  result,
  reduced: reducedProp = false,
  onWriteAnother,
  aiFeedbackLoader,
}: {
  result: EssayGradingResult;
  reduced?: boolean;
  onWriteAnother?: () => void;
  /** When provided (and the essay is graded), shows the on-demand AI panel. */
  aiFeedbackLoader?: () => Promise<EssayAiFeedbackResponse>;
}) {
  const osReduced = useReducedMotion();
  const reduced = reducedProp || Boolean(osReduced);

  const dims: EssayDimensionScoresDto | null = result.dimensions;
  const emailDims: EmailDimensionScoresDto | null =
    result.emailDimensions ?? null;
  const isAi = result.source === EssayScoreSource.AI_HYBRID;
  const integrity = result.integrity ?? null;
  const showIntegrity =
    integrity != null &&
    (integrity.isMalpractice ||
      integrity.warnings > 0 ||
      integrity.flags.length > 0);

  // Count up the headline total (instant final value under reduced motion).
  const totalDisplay = useCountUp(result.total ?? 0, { decimals: 1 });

  return (
    <div className="space-y-6">
      {/* Score headline */}
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-subtle bg-surface-raised p-6 text-center">
        <SourceBadge source={result.source} />
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-5xl font-bold text-ink">
            {result.total !== null ? totalDisplay : "—"}
          </span>
          <span className="text-lg text-ink-muted">/100</span>
        </div>
        <p className="text-sm text-ink-muted">
          {result.wordCount} words ·{" "}
          {isAi ? "AI-reviewed grade" : "Auto-scored grade"}
        </p>
      </div>

      {/* Proctoring / integrity record (proctored essays only). Advisory: it
          reports warnings + flags for review and never changes the score. */}
      {showIntegrity && integrity ? (
        <div
          className={`space-y-2 rounded-2xl border p-5 ${
            integrity.isMalpractice
              ? "border-error/50 bg-error/5"
              : "border-warning/50 bg-warning/5"
          }`}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert
              className={`h-4 w-4 ${integrity.isMalpractice ? "text-error-fg" : "text-warning-fg"}`}
            />
            <h3 className="text-sm font-semibold text-ink">
              Proctoring record
            </h3>
          </div>
          <p className="text-sm text-ink-secondary">
            {integrity.isMalpractice
              ? "This attempt was flagged for review."
              : "This attempt was monitored."}{" "}
            {integrity.warnings} warning{integrity.warnings === 1 ? "" : "s"}{" "}
            recorded. These signals are advisory and do not change your score.
          </p>
          {integrity.flags.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-secondary">
              {integrity.flags.map((f) => (
                <li key={f}>{INTEGRITY_FLAG_LABEL[f] ?? f}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Per-dimension breakdown */}
      {dims ? (
        <div className="space-y-3 rounded-2xl border border-subtle bg-surface-raised p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">
              Dimension breakdown
            </h3>
            <span className="text-xs text-ink-muted">
              % = weight toward total
            </span>
          </div>
          {reduced ? (
            <div className="space-y-2.5">
              {ORDER.map((dim) => (
                <DimensionRow key={dim} dim={dim} score={dims[dim]} reduced />
              ))}
            </div>
          ) : (
            <Stagger className="space-y-2.5">
              {ORDER.map((dim) => (
                <StaggerItem key={dim}>
                  <DimensionRow dim={dim} score={dims[dim]} reduced={false} />
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </div>
      ) : null}

      {/* Email breakdown (Communication module — email rubric). Same bar UI,
          the email weight table, reduced-motion friendly (no stagger). */}
      {emailDims ? (
        <div className="space-y-3 rounded-2xl border border-subtle bg-surface-raised p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">
              Email breakdown
            </h3>
            <span className="text-xs text-ink-muted">
              % = weight toward total
            </span>
          </div>
          <div className="space-y-2.5">
            {EMAIL_ORDER.map((dim) => {
              const score = emailDims[dim];
              const weightPct = Math.round(EMAIL_SCORE_WEIGHTS[dim] * 100);
              const pct = Math.min(100, Math.max(0, score));
              return (
                <div
                  key={dim}
                  className="grid grid-cols-[11rem_1fr_3.5rem] items-center gap-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-ink">
                      {EMAIL_DIMENSION_LABEL[dim]}
                    </span>
                    <span className="rounded bg-surface-overlay px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                      {weightPct}%
                    </span>
                  </div>
                  <div
                    className="h-2.5 overflow-hidden rounded-full bg-surface-sunken"
                    role="progressbar"
                    aria-valuenow={Math.round(score)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={EMAIL_DIMENSION_LABEL[dim]}
                  >
                    <div
                      className={`h-full rounded-full ${barColor(score)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-right font-mono text-sm text-ink">
                    {score.toFixed(0)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Feedback */}
      {result.feedback ? (
        <div className="rounded-2xl border border-subtle bg-surface-raised p-6">
          <h3 className="mb-2 text-sm font-semibold text-ink">
            {isAi ? "Reviewer feedback" : "Automated notes"}
          </h3>
          <p className="whitespace-pre-line text-sm leading-6 text-ink-secondary">
            {result.feedback}
          </p>
        </div>
      ) : null}

      {/* On-demand AI Scoring & Feedback (supplementary to the score above) */}
      {aiFeedbackLoader && result.total !== null ? (
        <EssayAiFeedbackPanel load={aiFeedbackLoader} />
      ) : null}

      {onWriteAnother ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={onWriteAnother}>
            <RotateCcw className="h-4 w-4" /> Write another
          </Button>
        </div>
      ) : null}
    </div>
  );
}
