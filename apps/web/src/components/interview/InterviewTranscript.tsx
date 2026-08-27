/**
 * The running conversation transcript (Step 36 A). Renders the pure
 * `state.messages` from the interview reducer so the greeting, per-turn
 * acknowledgements, questions and closing are ALL persistently visible — and
 * VISUALLY DISTINCT: interviewer glue (greeting/ack/closing) reads as spoken
 * asides, questions are emphasised, and the candidate's own answers are aligned
 * to the other side. This is the surface that was missing in Step 35 (the lines
 * only flashed during the sub-second "asking" phase).
 */
import type { InterviewMessage } from "../../lib/interview-runner.js";

const KIND_LABEL: Record<InterviewMessage["kind"], string> = {
  greeting: "Interviewer",
  acknowledgement: "Interviewer",
  question: "Interviewer · question",
  answer: "You",
  closing: "Interviewer",
};

export function InterviewTranscript({
  messages,
}: {
  messages: readonly InterviewMessage[];
}): JSX.Element | null {
  if (messages.length === 0) return null;
  return (
    <div className="space-y-2" aria-label="Interview transcript" data-testid="interview-transcript">
      {messages.map((m) => {
        const isCandidate = m.role === "candidate";
        const isQuestion = m.kind === "question";
        return (
          <div
            key={m.id}
            data-kind={m.kind}
            className={`flex ${isCandidate ? "justify-end" : "justify-start"}`}
          >
            <div
              className={[
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                isCandidate
                  ? "bg-primary/10 text-ink"
                  : isQuestion
                    ? "bg-surface-muted font-medium text-ink"
                    : "bg-transparent italic text-ink-muted",
              ].join(" ")}
            >
              <div className="mb-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
                {KIND_LABEL[m.kind]}
              </div>
              {m.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
