/**
 * dictation — the ONE typed item. No microphone: the student hears the sentence
 * (shell plays the prompt audio) and TYPES it. This renderer OWNS its capture
 * widget (the text box + submit) — the divergent capture mode, exactly the seam
 * the contract's `capture: "text"` marks. The shell does the submit + advance
 * via `submitText`; there is no recorder here.
 */
import { useState } from "react";

import { Button } from "../../ui/button.js";
import type { SpeakingRendererProps } from "../renderer-contract.js";

export function DictationRenderer({
  view,
  locked,
  submitText,
}: SpeakingRendererProps): JSX.Element {
  const [text, setText] = useState("");
  const canSubmit = text.trim().length > 0 && !locked;
  return (
    <div className="space-y-3">
      <p className="text-base text-ink">
        {view.promptText || "Type exactly what you hear."}
      </p>
      <textarea
        className="min-h-[96px] w-full rounded-xl border border-subtle bg-surface p-3 text-ink outline-none focus:border-primary"
        placeholder="Type the sentence you heard…"
        value={text}
        disabled={locked}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-muted">
          Typed, not spoken — spelling counts (a homophone is an error).
        </span>
        <Button
          disabled={!canSubmit}
          onClick={() => submitText?.(text.trim())}
        >
          Submit answer
        </Button>
      </div>
    </div>
  );
}
