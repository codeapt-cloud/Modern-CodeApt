/**
 * AI Feedback panel — an ON-DEMAND, QUALITATIVE view that complements (never
 * competes with) the single grade shown above. Renders a button; on click it
 * calls `load` (a bound API call) and shows a short summary plus Strengths /
 * Areas to improve / Suggestions. It deliberately does NOT show the model's own
 * numeric scores: the essay has ONE score — the grade above — and a second set
 * of AI numbers only confuses. Graceful states: "not available" when AI is off
 * (no gateway/key or the college's AI toggle is off), and "couldn't generate"
 * when the model returned nothing usable. Reused by the student result view and
 * the faculty results table.
 */
import type { EssayAiFeedbackResponse, EssayAiFeedback } from "@codeapt/shared";
import { Sparkles, ThumbsUp, ThumbsDown, Lightbulb } from "lucide-react";
import { useState } from "react";

import { parseApiError } from "../../lib/api-client.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";

function ItemList({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {icon}
        {title}
      </h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-secondary">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function FeedbackBody({ feedback }: { feedback: EssayAiFeedback }) {
  return (
    <div className="space-y-4">
      {feedback.summary ? (
        <p className="text-sm leading-6 text-ink-secondary">{feedback.summary}</p>
      ) : null}
      <ItemList
        title="Strengths"
        icon={<ThumbsUp className="h-4 w-4 text-success-fg" />}
        items={feedback.pros}
      />
      <ItemList
        title="Areas to improve"
        icon={<ThumbsDown className="h-4 w-4 text-warning-fg" />}
        items={feedback.cons}
      />
      <ItemList
        title="Suggestions"
        icon={<Lightbulb className="h-4 w-4 text-primary" />}
        items={feedback.improvements}
      />
      <p className="text-[11px] text-ink-muted">
        AI-written guidance to improve the essay — the grade shown above is the
        score.
      </p>
    </div>
  );
}

export function EssayAiFeedbackPanel({
  load,
  className = "",
}: {
  load: () => Promise<EssayAiFeedbackResponse>;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<EssayAiFeedbackResponse | null>(null);
  const [error, setError] = useState("");

  const run = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      setRes(await load());
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <Button variant="secondary" loading={busy} onClick={() => void run()}>
        <Sparkles className="h-4 w-4" /> AI Feedback
      </Button>

      {error ? <Alert variant="error">{error}</Alert> : null}

      {res && !res.configured ? (
        <Alert variant="info">
          AI scoring &amp; feedback isn't available for this essay. Ask your
          administrator to enable the AI provider (and the college's AI &rarr;
          Essay Grading permission).
        </Alert>
      ) : null}

      {res && res.configured && !res.feedback ? (
        <Alert variant="warning">
          The AI couldn't produce usable feedback this time — please try again.
        </Alert>
      ) : null}

      {res && res.configured && res.feedback ? (
        <div className="rounded-2xl border border-subtle bg-surface-raised p-5">
          <FeedbackBody feedback={res.feedback} />
        </div>
      ) : null}
    </div>
  );
}
