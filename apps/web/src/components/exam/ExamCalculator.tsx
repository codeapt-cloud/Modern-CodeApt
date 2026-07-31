/**
 * A floating, draggable, retractable basic calculator for the exam runner.
 *
 * Pure UI: it owns ALL of its state (position, minimized, arithmetic via
 * `lib/calculator`). It never reads or writes exam answers, navigation, the
 * timer, autosave, or submit. Keyboard handling is scoped to the widget (an
 * onKeyDown on its own container) so it can NEVER steal keys from the code
 * editor or MCQ inputs.
 */
import { Calculator, GripHorizontal, Minus, X } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { cn } from "../../lib/cn.js";
import {
  applyKey,
  initialCalc,
  keyboardKeyToCalc,
  type CalcState,
} from "../../lib/calculator.js";

interface Pos {
  x: number;
  y: number;
}

const WIDTH = 260;
const HEIGHT = 360;

function clampToViewport(p: Pos, height: number): Pos {
  if (typeof window === "undefined") return p;
  const maxX = Math.max(0, window.innerWidth - WIDTH);
  const maxY = Math.max(0, window.innerHeight - height);
  return {
    x: Math.min(Math.max(p.x, 0), maxX),
    y: Math.min(Math.max(p.y, 0), maxY),
  };
}

export function ExamCalculator({ onClose }: { onClose: () => void }) {
  const [state, dispatch] = useReducer(applyKey, initialCalc);
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState<Pos>(() =>
    clampToViewport(
      typeof window === "undefined"
        ? { x: 24, y: 96 }
        : { x: window.innerWidth - WIDTH - 24, y: 96 },
      HEIGHT,
    ),
  );

  // --- Dragging (pointer events; no external lib) ---------------------------
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    },
    [pos.x, pos.y],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setPos(
        clampToViewport(
          { x: e.clientX - drag.dx, y: e.clientY - drag.dy },
          minimized ? 44 : HEIGHT,
        ),
      );
    },
    [minimized],
  );
  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Keep it on-screen if the window resizes.
  useEffect(() => {
    const onResize = (): void =>
      setPos((p) => clampToViewport(p, minimized ? 44 : HEIGHT));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minimized]);

  // Keyboard — SCOPED to the widget (only fires when it has focus). Never a
  // global/window listener, so code-editor and MCQ typing are untouched.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const mapped = keyboardKeyToCalc(e.key);
    if (mapped === null) return;
    e.preventDefault();
    dispatch(mapped);
  }, []);

  return (
    <div
      role="dialog"
      aria-label="Calculator"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed z-40 w-[260px] select-none rounded-xl border border-strong bg-surface-raised shadow-lg focus:outline-none"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Title bar (drag handle) */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex cursor-move items-center gap-2 rounded-t-xl border-b border-subtle bg-surface-base px-3 py-2"
      >
        <GripHorizontal className="h-4 w-4 text-ink-muted" />
        <Calculator className="h-4 w-4 text-ink-muted" />
        <span className="flex-1 text-xs font-semibold text-ink">Calculator</span>
        <button
          type="button"
          aria-label={minimized ? "Restore calculator" : "Minimize calculator"}
          onClick={() => setMinimized((m) => !m)}
          className="rounded p-1 text-ink-muted hover:bg-surface-overlay hover:text-ink"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Close calculator"
          onClick={onClose}
          className="rounded p-1 text-ink-muted hover:bg-surface-overlay hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {minimized ? null : <CalculatorBody state={state} dispatch={dispatch} />}
    </div>
  );
}

function CalculatorBody({
  state,
  dispatch,
}: {
  state: CalcState;
  dispatch: (key: string) => void;
}) {
  return (
    <div className="p-3">
      {/* Display */}
      <div
        className="mb-3 overflow-x-auto rounded-lg border border-subtle bg-surface-base px-3 py-3 text-right font-mono text-2xl tabular-nums text-ink"
        aria-live="polite"
      >
        {state.display}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-4 gap-1.5">
        <Key label="C" onPress={dispatch} variant="fn" />
        <Key label="+/-" onPress={dispatch} variant="fn" />
        <Key label="%" onPress={dispatch} variant="fn" />
        <Key label="/" display="÷" onPress={dispatch} variant="op" />

        <Key label="7" onPress={dispatch} />
        <Key label="8" onPress={dispatch} />
        <Key label="9" onPress={dispatch} />
        <Key label="*" display="×" onPress={dispatch} variant="op" />

        <Key label="4" onPress={dispatch} />
        <Key label="5" onPress={dispatch} />
        <Key label="6" onPress={dispatch} />
        <Key label="-" display="−" onPress={dispatch} variant="op" />

        <Key label="1" onPress={dispatch} />
        <Key label="2" onPress={dispatch} />
        <Key label="3" onPress={dispatch} />
        <Key label="+" onPress={dispatch} variant="op" />

        <Key label="back" display="⌫" onPress={dispatch} variant="fn" />
        <Key label="0" onPress={dispatch} />
        <Key label="." onPress={dispatch} />
        <Key label="=" onPress={dispatch} variant="eq" />
      </div>
    </div>
  );
}

function Key({
  label,
  display,
  onPress,
  variant = "num",
}: {
  label: string;
  display?: string;
  onPress: (key: string) => void;
  variant?: "num" | "op" | "fn" | "eq";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onPress(label)}
      className={cn(
        "flex h-10 items-center justify-center rounded-lg border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-focus",
        variant === "num" &&
          "border-subtle bg-surface-base text-ink hover:border-primary/40",
        variant === "op" &&
          "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
        variant === "fn" &&
          "border-subtle bg-surface-overlay text-ink-muted hover:text-ink",
        variant === "eq" &&
          "border-primary bg-primary text-white hover:bg-primary-400",
      )}
    >
      {display ?? label}
    </button>
  );
}
