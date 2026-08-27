/**
 * Animated SVG interviewer (Step 35 C). Replaces the static portrait with a
 * living figure — no video asset, no external service, one component:
 *   - mouth movement driven by SpeechSynthesis BOUNDARY events (the `pulse` prop)
 *     so it tracks the real audio while speaking;
 *   - periodic blinking + a subtle idle breathe/sway so it never looks frozen;
 *   - four distinct states: idle, speaking, listening, thinking;
 *   - respects prefers-reduced-motion (all looping motion is disabled there).
 * All motion is CSS keyframes (guarded by the media query); the mouth reacts to
 * `pulse` via React so it stays in sync with actual speech, not a fixed loop.
 */
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

// Scoped keyframes (iv- prefix). Looping motion is disabled under reduced-motion.
const STYLES = `
@keyframes iv-breathe { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-1.2px) scale(1.015); } }
@keyframes iv-sway { 0%,100% { transform: rotate(-1.1deg); } 50% { transform: rotate(1.1deg); } }
@keyframes iv-blink { 0%,92%,100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
@keyframes iv-nod { 0%,100% { transform: translateY(0); } 50% { transform: translateY(1.4px); } }
@keyframes iv-think { 0% { opacity: .3; } 50% { opacity: 1; } 100% { opacity: .3; } }
.iv-figure { transform-origin: 50% 70%; animation: iv-breathe 4.2s ease-in-out infinite; }
.iv-figure.iv-listening { animation: iv-nod 2.6s ease-in-out infinite; }
.iv-head { transform-origin: 50% 60%; animation: iv-sway 6s ease-in-out infinite; }
.iv-eye { transform-origin: center; transform-box: fill-box; animation: iv-blink 5s ease-in-out infinite; }
.iv-eye.iv-r { animation-delay: .04s; }
.iv-dot { animation: iv-think 1.2s ease-in-out infinite; }
.iv-dot.iv-2 { animation-delay: .2s; }
.iv-dot.iv-3 { animation-delay: .4s; }
@media (prefers-reduced-motion: reduce) {
  .iv-figure, .iv-figure.iv-listening, .iv-head, .iv-eye, .iv-dot { animation: none !important; }
}
`;

export function InterviewAvatar({
  state,
  pulse,
}: {
  state: AvatarState;
  pulse: number;
}): JSX.Element {
  // Boundary pulse → a mouth-open delta, only while speaking. Alternates so
  // successive word boundaries visibly open/close the mouth.
  const mouthOpen = state === "speaking" ? 3 + (pulse % 2) * 6 : 2;
  const speaking = state === "speaking";
  return (
    <div className="flex flex-col items-center gap-3">
      <style>{STYLES}</style>
      <div
        className={`relative flex h-40 w-40 items-center justify-center rounded-full bg-surface ring-4 ${RING[state]} transition-colors`}
        aria-label={LABEL[state]}
        role="img"
      >
        <svg viewBox="0 0 100 100" className="h-32 w-32" aria-hidden>
          <g className={`iv-figure ${state === "listening" ? "iv-listening" : ""}`}>
            {/* shoulders */}
            <path d="M18 96 Q50 64 82 96 Z" className="fill-primary/20" />
            <g className="iv-head">
              {/* head */}
              <circle cx="50" cy="42" r="24" className="fill-primary/20" />
              {/* eyes — blink via scaleY keyframe */}
              <rect className="iv-eye fill-ink" x="40" y="37" width="4.5" height="6" rx="2" />
              <rect className="iv-eye iv-r fill-ink" x="55.5" y="37" width="4.5" height="6" rx="2" />
              {/* brows (static) */}
              <rect x="39.5" y="33" width="6" height="1.6" rx="0.8" className="fill-ink/50" />
              <rect x="54.5" y="33" width="6" height="1.6" rx="0.8" className="fill-ink/50" />
              {/* mouth — width narrows + height tracks the speaking pulse */}
              <rect
                x={speaking ? 45.5 : 44}
                y={52 - mouthOpen / 2}
                width={speaking ? 9 : 12}
                height={mouthOpen}
                rx="2"
                className="fill-ink/70 transition-all duration-100"
              />
            </g>
          </g>
        </svg>

        {state === "thinking" ? (
          <span className="absolute bottom-3 flex items-center gap-1 text-warning-fg">
            <span className="iv-dot h-1.5 w-1.5 rounded-full bg-current" />
            <span className="iv-dot iv-2 h-1.5 w-1.5 rounded-full bg-current" />
            <span className="iv-dot iv-3 h-1.5 w-1.5 rounded-full bg-current" />
          </span>
        ) : null}
      </div>
      <span className="text-sm text-ink-muted">{LABEL[state]}</span>
    </div>
  );
}
