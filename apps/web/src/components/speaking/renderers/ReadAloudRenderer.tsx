/**
 * read_aloud — the text on screen IS the task. The student reads `referenceText`
 * aloud; the shell owns the record control + window countdown. (Stimulus only.)
 */
import type { SpeakingRendererProps } from "../renderer-contract.js";

export function ReadAloudRenderer({ view }: SpeakingRendererProps): JSX.Element {
  return (
    <div className="space-y-2">
      {view.promptText ? (
        <p className="text-sm text-ink-muted">{view.promptText}</p>
      ) : (
        <p className="text-sm text-ink-muted">Read the sentence below aloud, clearly.</p>
      )}
      <blockquote className="rounded-xl border border-subtle bg-surface-sunken p-4 text-lg leading-relaxed text-ink">
        {view.referenceText}
      </blockquote>
    </div>
  );
}
