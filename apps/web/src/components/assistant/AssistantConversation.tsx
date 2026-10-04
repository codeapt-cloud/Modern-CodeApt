/**
 * AssistantConversation (Step 39) — presentational render of the conversation:
 * user turns, assistant turns (clarifying questions are just assistant turns, kept
 * readable), the tools a turn ran ("ran: list_exams"), proposal cards, errors, and
 * a thinking indicator. Pure/props-driven so it is directly testable.
 */
import type { AssistantEntry } from "../../providers/AssistantProvider.js";
import { GuideSteps } from "./GuideSteps.js";

export interface AssistantConversationProps {
  entries: AssistantEntry[];
  busy: boolean;
  onToggleStep: (entryId: string, index: number) => void;
  /** Current college slug (resolves step deep links) + in-app navigation. */
  slug?: string;
  onNavigate?: (path: string) => void;
}

export function AssistantConversation({
  entries,
  busy,
  onToggleStep,
  slug,
  onNavigate,
}: AssistantConversationProps) {
  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => {
        if (entry.role === "user") {
          return (
            <div key={entry.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-ink-inverse">
                {entry.text}
              </div>
            </div>
          );
        }
        if (entry.role === "assistant") {
          return (
            <div key={entry.id} className="flex flex-col items-start gap-1">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-surface-overlay px-3 py-2 text-sm text-ink">
                {entry.text}
              </div>
              {entry.tools.length > 0 ? (
                <div className="pl-1">
                  <span
                    data-testid="assistant-tool"
                    className="rounded bg-surface-base px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
                  >
                    ran: {[...new Set(entry.tools)].join(", ")}
                  </span>
                </div>
              ) : null}
            </div>
          );
        }
        if (entry.role === "guide") {
          return (
            <div key={entry.id} className="flex flex-col items-start gap-1">
              {entry.intro ? (
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-surface-overlay px-3 py-2 text-sm text-ink">
                  {entry.intro}
                </div>
              ) : null}
              {entry.tools.length > 0 ? (
                <div className="pl-1">
                  <span
                    data-testid="assistant-tool"
                    className="rounded bg-surface-base px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
                  >
                    ran: {[...new Set(entry.tools)].join(", ")}
                  </span>
                </div>
              ) : null}
              <div className="w-full">
                <GuideSteps
                  steps={entry.steps}
                  checked={entry.checked}
                  onToggle={(i) => onToggleStep(entry.id, i)}
                  slug={slug}
                  onNavigate={onNavigate}
                />
              </div>
            </div>
          );
        }
        // error
        return (
          <div
            key={entry.id}
            data-testid="assistant-error"
            className="rounded-lg border border-error/40 bg-error-subtle p-3 text-sm text-error-fg"
          >
            {entry.text}
          </div>
        );
      })}

      {busy ? (
        <div
          data-testid="assistant-thinking"
          className="flex items-center gap-2 text-xs text-ink-muted"
          role="status"
        >
          <span className="inline-flex gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:300ms]" />
          </span>
          Thinking…
        </div>
      ) : null}
    </div>
  );
}
