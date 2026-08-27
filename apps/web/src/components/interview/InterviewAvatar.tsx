/**
 * Animated SVG interviewer (Step 34 A2 → reworked Step 36 C). The Step-35 version
 * only changed mouth OPENNESS — a hinge, not speech. This version:
 *   - cycles VISEMES on SpeechSynthesis boundary events (closed → slightly-open →
 *     wide → rounded), with CSS easing between shapes, not a binary flip;
 *   - adds micro-motion: head tilt/breathe, eye saccades, and a brow lift while
 *     speaking (a hint of intonation);
 *   - blinks IRREGULARLY (~16/min, uneven) via a randomised timer;
 *   - makes "listening" attentive — a slight forward lean + occasional nod.
 * Still one SVG component, no asset, no service. All looping motion is disabled
 * under prefers-reduced-motion (and the blink timer is not scheduled there).
 */
import { useEffect, useRef, useState } from "react";

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

// Four mouth shapes (rx/ry of an ellipse) cycled on boundary events. Rounded is
// narrow+tall; wide is broad+open. Easing (CSS transition) makes it read as speech.
const VISEMES: ReadonlyArray<{ rx: number; ry: number }> = [
  { rx: 6.5, ry: 0.8 }, // closed
  { rx: 6, ry: 2.6 }, // slightly open
  { rx: 8, ry: 4.2 }, // wide
  { rx: 4.2, ry: 4.6 }, // rounded
];

const STYLES = `
@keyframes iv-breathe { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-1px) scale(1.012); } }
@keyframes iv-sway { 0%,100% { transform: rotate(-1deg); } 50% { transform: rotate(1.2deg); } }
@keyframes iv-lean { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(1.2px) rotate(-1.4deg); } }
@keyframes iv-saccade { 0%,60%,100% { transform: translateX(0); } 70%,82% { transform: translateX(1px); } }
@keyframes iv-brow { 0%,100% { transform: translateY(0); } 40% { transform: translateY(-1px); } }
@keyframes iv-think { 0%,100% { opacity: .3; } 50% { opacity: 1; } }
.iv-fig { transform-origin: 50% 72%; animation: iv-breathe 4.6s ease-in-out infinite; }
.iv-fig.iv-listen { animation: iv-lean 3.4s ease-in-out infinite; }
.iv-head { transform-origin: 50% 60%; animation: iv-sway 6.5s ease-in-out infinite; }
.iv-head.iv-listen { animation: iv-sway 3s ease-in-out infinite; }
.iv-pupils { animation: iv-saccade 7s ease-in-out infinite; }
.iv-brow { transform-origin: center; transform-box: fill-box; }
.iv-brow.iv-spk { animation: iv-brow 0.9s ease-in-out infinite; }
.iv-mouth { transition: rx 90ms ease-out, ry 90ms ease-out; }
.iv-dot { animation: iv-think 1.2s ease-in-out infinite; }
.iv-dot.iv-2 { animation-delay: .18s; }
.iv-dot.iv-3 { animation-delay: .36s; }
@media (prefers-reduced-motion: reduce) {
  .iv-fig, .iv-fig.iv-listen, .iv-head, .iv-head.iv-listen, .iv-pupils, .iv-brow.iv-spk, .iv-dot { animation: none !important; }
  .iv-mouth { transition: none !important; }
}
`;

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

export function InterviewAvatar({
  state,
  pulse,
}: {
  state: AvatarState;
  pulse: number;
}): JSX.Element {
  const speaking = state === "speaking";
  const listening = state === "listening";
  const [blink, setBlink] = useState(false);

  // Irregular blinking: schedule the next blink 2.5–6s out (humans ~16/min,
  // uneven). Not scheduled under reduced motion.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let alive = true;
    const schedule = (): void => {
      const delay = 2500 + Math.random() * 3500;
      timerRef.current = setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        timerRef.current = setTimeout(() => {
          if (!alive) return;
          setBlink(false);
          schedule();
        }, 110);
      }, delay);
    };
    schedule();
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Mouth shape: cycle visemes on boundary pulses while speaking; a gentle near-
  // closed rest otherwise.
  const v = speaking ? VISEMES[pulse % VISEMES.length]! : { rx: 6.5, ry: 1.1 };
  const eyeRy = blink ? 0.4 : 2.4;

  return (
    <div className="flex flex-col items-center gap-3">
      <style>{STYLES}</style>
      <div
        className={`relative flex h-40 w-40 items-center justify-center rounded-full bg-surface ring-4 ${RING[state]} transition-colors`}
        aria-label={LABEL[state]}
        role="img"
      >
        <svg viewBox="0 0 100 100" className="h-32 w-32" aria-hidden>
          <g className={`iv-fig ${listening ? "iv-listen" : ""}`}>
            <path d="M18 96 Q50 64 82 96 Z" className="fill-primary/20" />
            <g className={`iv-head ${listening ? "iv-listen" : ""}`}>
              <circle cx="50" cy="42" r="24" className="fill-primary/20" />
              {/* brows — lift subtly while speaking */}
              <rect className={`iv-brow ${speaking ? "iv-spk" : ""} fill-ink/50`} x="39.5" y="33" width="6" height="1.6" rx="0.8" />
              <rect className={`iv-brow ${speaking ? "iv-spk" : ""} fill-ink/50`} x="54.5" y="33" width="6" height="1.6" rx="0.8" />
              {/* eyes — pupils saccade; eyelids blink via ry */}
              <g className="iv-pupils">
                <ellipse cx="42" cy="40" rx="2.4" ry={eyeRy} className="fill-ink" style={{ transition: "ry 80ms" }} />
                <ellipse cx="58" cy="40" rx="2.4" ry={eyeRy} className="fill-ink" style={{ transition: "ry 80ms" }} />
              </g>
              {/* mouth — viseme ellipse with eased shape changes */}
              <ellipse className="iv-mouth fill-ink/70" cx="50" cy="52" rx={v.rx} ry={v.ry} />
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
