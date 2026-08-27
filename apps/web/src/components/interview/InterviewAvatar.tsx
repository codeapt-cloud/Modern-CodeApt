/**
 * The interviewer figure (Step 34 A2). A STATIC SVG portrait — no video asset, no
 * lip-sync — with four visual states: idle, speaking (a subtle mouth pulse driven
 * by SpeechSynthesis boundary events via the `pulse` prop), listening (while the
 * student answers), and thinking (while the server round-trips — never dead air).
 * Most of the presence for a fraction of the build.
 */
import { Loader2 } from "lucide-react";

export type AvatarState = "idle" | "speaking" | "listening" | "thinking";

const LABEL: Record<AvatarState, string> = {
  idle: "Ready",
  speaking: "Interviewer speaking…",
  listening: "Listening…",
  thinking: "Thinking…",
};
const RING: Record<AvatarState, string> = {
  idle: "ring-subtle",
  speaking: "ring-primary",
  listening: "ring-success-fg",
  thinking: "ring-warning-fg",
};

export function InterviewAvatar({
  state,
  pulse,
}: {
  state: AvatarState;
  pulse: number;
}): JSX.Element {
  // Boundary pulse → a small mouth-open delta, only while speaking.
  const mouthOpen = state === "speaking" ? 4 + (pulse % 2) * 4 : 2;
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`relative flex h-40 w-40 items-center justify-center rounded-full bg-surface ring-4 ${RING[state]} transition-colors`}
        aria-label={LABEL[state]}
      >
        <svg viewBox="0 0 100 100" className="h-32 w-32" role="img" aria-hidden>
          {/* head */}
          <circle cx="50" cy="42" r="24" className="fill-primary/20" />
          {/* eyes */}
          <circle cx="42" cy="40" r="2.5" className="fill-ink" />
          <circle cx="58" cy="40" r="2.5" className="fill-ink" />
          {/* mouth — height tracks the speaking pulse */}
          <rect
            x="42"
            y={50 - mouthOpen / 2}
            width="16"
            height={mouthOpen}
            rx="2"
            className="fill-ink/70 transition-all duration-100"
          />
          {/* shoulders */}
          <path d="M20 92 Q50 66 80 92 Z" className="fill-primary/20" />
        </svg>
        {state === "thinking" ? (
          <span className="absolute bottom-2 right-2 text-warning-fg">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
        ) : null}
      </div>
      <span className="text-sm text-ink-muted">{LABEL[state]}</span>
    </div>
  );
}
