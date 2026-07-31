/**
 * Pure state machine for a basic four-function on-screen calculator (immediate
 * execution, like a physical placement-exam calculator — no operator
 * precedence). Kept free of React/DOM so the arithmetic is exhaustively
 * unit-testable; the widget is a thin shell that folds key presses through
 * `applyKey`.
 *
 * Keys: "0".."9", ".", "+", "-", "*", "/", "=", "%", "+/-", "back", "C".
 * Divide-by-zero → an "Error" state that a digit (or C) recovers from.
 */
export type CalcOp = "+" | "-" | "*" | "/";

export interface CalcState {
  /** The text shown on the display. */
  display: string;
  /** Stored left operand for the pending operation. */
  accumulator: number | null;
  pendingOp: CalcOp | null;
  /** Next digit starts a fresh entry (after an operator or "="). */
  overwrite: boolean;
  error: boolean;
}

export const initialCalc: CalcState = {
  display: "0",
  accumulator: null,
  pendingOp: null,
  overwrite: true,
  error: false,
};

const ERROR_STATE: CalcState = {
  display: "Error",
  accumulator: null,
  pendingOp: null,
  overwrite: true,
  error: true,
};

/** Max significant characters entered (guards runaway input). */
const MAX_DIGITS = 15;

/** Format a number for the display: strip FP noise, keep it compact. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  const rounded = Math.round((n + Number.EPSILON) * 1e10) / 1e10;
  let s = String(rounded);
  if (s.replace(/[-.]/g, "").length > MAX_DIGITS) {
    s = rounded.toPrecision(10).replace(/\.?0+$/, "");
  }
  return s;
}

function compute(a: number, op: CalcOp, b: number): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? NaN : a / b;
  }
}

const isDigit = (k: string): boolean => /^[0-9]$/.test(k);
const isOp = (k: string): k is CalcOp =>
  k === "+" || k === "-" || k === "*" || k === "/";

/** Fold a single key press into the calculator state (pure). */
export function applyKey(state: CalcState, key: string): CalcState {
  if (key === "C") return initialCalc;

  // In an error state only a digit (or ".") — or C, handled above — recovers.
  if (state.error) {
    if (isDigit(key)) return { ...initialCalc, display: key, overwrite: false };
    if (key === ".") return { ...initialCalc, display: "0.", overwrite: false };
    return state;
  }

  if (isDigit(key)) {
    if (state.overwrite) return { ...state, display: key, overwrite: false };
    if (state.display.replace(/[-.]/g, "").length >= MAX_DIGITS) return state;
    return {
      ...state,
      display: state.display === "0" ? key : state.display + key,
    };
  }

  if (key === ".") {
    if (state.overwrite) return { ...state, display: "0.", overwrite: false };
    if (state.display.includes(".")) return state;
    return { ...state, display: state.display + "." };
  }

  if (key === "back") {
    if (state.overwrite) return state;
    const trimmed = state.display.slice(0, -1);
    const next = trimmed === "" || trimmed === "-" ? "0" : trimmed;
    return { ...state, display: next };
  }

  if (key === "+/-") {
    if (state.display === "0") return state;
    const next = state.display.startsWith("-")
      ? state.display.slice(1)
      : `-${state.display}`;
    return { ...state, display: next };
  }

  if (key === "%") {
    const current = parseFloat(state.display);
    // Accumulator-aware: "200 + 10 %" → 20 (10% of 200); standalone → /100.
    const pct =
      state.pendingOp !== null && state.accumulator !== null
        ? (state.accumulator * current) / 100
        : current / 100;
    return { ...state, display: fmt(pct), overwrite: false };
  }

  if (isOp(key)) {
    const current = parseFloat(state.display);
    // Chain: an unconsumed operand + a pending op computes first (immediate).
    if (state.pendingOp !== null && !state.overwrite && state.accumulator !== null) {
      const r = compute(state.accumulator, state.pendingOp, current);
      if (!Number.isFinite(r)) return ERROR_STATE;
      return { ...state, display: fmt(r), accumulator: r, pendingOp: key, overwrite: true };
    }
    return { ...state, accumulator: current, pendingOp: key, overwrite: true };
  }

  if (key === "=") {
    if (state.pendingOp === null || state.accumulator === null) {
      return { ...state, overwrite: true };
    }
    const current = parseFloat(state.display);
    const r = compute(state.accumulator, state.pendingOp, current);
    if (!Number.isFinite(r)) return ERROR_STATE;
    return {
      ...state,
      display: fmt(r),
      accumulator: null,
      pendingOp: null,
      overwrite: true,
    };
  }

  return state; // unknown key → no-op
}

/** Test/util helper: fold a sequence of keys and return the final display. */
export function runKeys(keys: string[], start: CalcState = initialCalc): string {
  return keys.reduce(applyKey, start).display;
}

/** Map a keyboard event key to a calculator key, or null if not handled. */
export function keyboardKeyToCalc(k: string): string | null {
  if (isDigit(k) || k === "." || isOp(k) || k === "%") return k;
  if (k === "Enter" || k === "=") return "=";
  if (k === "Backspace") return "back";
  if (k === "Escape" || k === "Delete" || k === "c" || k === "C") return "C";
  return null;
}
