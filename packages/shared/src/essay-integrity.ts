/**
 * Essay keystroke-integrity heuristic + proctoring warning policy — PURE, no I/O
 * and no React, so it is unit-tested independently of the (side-effectful)
 * composer and reused verbatim by the client.
 *
 * HONEST SCOPE — read this before trusting it:
 * A browser app cannot truly prevent a determined extension from injecting text
 * (a sophisticated one can even dispatch synthetic `keydown` events that look
 * human). The composer BLOCKS the common exfiltration/injection vector — paste —
 * and this heuristic DETECTS and FLAGS the rest as *advisory* signals for human
 * review. It does NOT and cannot guarantee prevention. A flag means "worth a
 * look," never "proven cheating."
 *
 * What it flags (all advisory):
 *  - a large block of text appearing in ONE input event with far more characters
 *    than the keystrokes that preceded it (paste that slipped through / an
 *    extension writing straight into the field);
 *  - a burst of characters faster than plausible human typing.
 *
 * The proctoring WARNING policy mirrors the exam runner exactly (shared
 * EXAM_MAX_WARNINGS): warnings 1..N are allowed with a prompt; crossing N flags
 * the attempt as malpractice and auto-submits. Essays reuse that same threshold
 * so the two assessment surfaces behave identically.
 */
import { EXAM_MAX_WARNINGS } from "./constants.js";

/** Tunables for the keystroke-integrity heuristic. */
export const ESSAY_INTEGRITY = {
  /**
   * Chars added in a SINGLE input event that we still treat as plausibly typed
   * even with no matching keystrokes (IME composition, autocomplete of a word,
   * fast correction). Above this, an input jump with no keystroke backing is a
   * burst-insert.
   */
  MAX_UNTYPED_JUMP: 24,
  /** A burst this large (chars in one event) is flagged regardless of timing. */
  HARD_JUMP: 120,
  /** Window used to judge "faster than human". */
  BURST_WINDOW_MS: 1000,
  /** Chars within BURST_WINDOW_MS (across events) that reads as inhuman speed. */
  BURST_CHARS: 100,
} as const;

/** The advisory flags this heuristic can raise (stored on the attempt). */
export const ESSAY_INTEGRITY_FLAG = {
  /** A big block appeared with no matching keystroke stream (injection/paste). */
  BURST_INSERT: "burst-insert",
  /** Characters accumulated faster than plausible human typing. */
  FAST_TYPING: "fast-typing",
  /** A paste was attempted (and blocked) during a proctored essay. */
  BLOCKED_PASTE: "blocked-paste",
} as const;

export type EssayIntegrityFlag =
  (typeof ESSAY_INTEGRITY_FLAG)[keyof typeof ESSAY_INTEGRITY_FLAG];

/**
 * Rolling tracker state. Pure data — the caller keeps it in a ref and threads it
 * through `creditKeystroke` / `analyzeInput`. `flags` is a de-duped, ordered
 * list of everything raised so far (what gets persisted on the attempt).
 */
export interface IntegrityState {
  /** Character length of the field at the last observed input event. */
  lastLen: number;
  /** performance.now()/Date.now() timestamp of the last input event (ms). */
  lastInputAt: number;
  /** Char-producing keystrokes seen since the last input event. */
  creditsSinceInput: number;
  /** Chars added inside the current burst window. */
  windowChars: number;
  /** Start of the current burst window (ms). */
  windowStart: number;
  /** All advisory flags raised so far, de-duped in raise-order. */
  flags: EssayIntegrityFlag[];
}

/** A fresh tracker for an empty field. */
export function createIntegrityState(): IntegrityState {
  return {
    lastLen: 0,
    lastInputAt: 0,
    creditsSinceInput: 0,
    windowChars: 0,
    windowStart: 0,
    flags: [],
  };
}

function withFlag(
  state: IntegrityState,
  flag: EssayIntegrityFlag,
): IntegrityState {
  if (state.flags.includes(flag)) return state;
  return { ...state, flags: [...state.flags, flag] };
}

/**
 * Credit one character-producing keystroke. Modifier/navigation keys don't
 * produce a character and must NOT be credited (they'd mask an injection).
 */
export function creditKeystroke(state: IntegrityState): IntegrityState {
  return { ...state, creditsSinceInput: state.creditsSinceInput + 1 };
}

/** Record a blocked paste as an advisory flag (the block itself is the defence). */
export function flagBlockedPaste(state: IntegrityState): IntegrityState {
  return withFlag(state, ESSAY_INTEGRITY_FLAG.BLOCKED_PASTE);
}

export interface AnalyzeInputResult {
  state: IntegrityState;
  /** A flag raised by THIS event (for a one-time toast), else null. */
  raised: EssayIntegrityFlag | null;
}

/**
 * Analyze one input event (the field value changed). `now` is passed in so the
 * function stays pure and testable. Only growth is analyzed — deletions/replaces
 * that shrink or keep length can't be an injection.
 */
export function analyzeInput(
  state: IntegrityState,
  opts: { prevLen: number; nextLen: number; now: number },
): AnalyzeInputResult {
  const { prevLen, nextLen, now } = opts;
  const delta = nextLen - prevLen;

  // Advance the rolling burst window first (using the char growth this event).
  let windowStart = state.windowStart;
  let windowChars = state.windowChars;
  if (now - windowStart > ESSAY_INTEGRITY.BURST_WINDOW_MS) {
    windowStart = now;
    windowChars = 0;
  }
  if (delta > 0) windowChars += delta;

  let next: IntegrityState = {
    ...state,
    lastLen: nextLen,
    lastInputAt: now,
    creditsSinceInput: 0, // consumed by this input event
    windowStart,
    windowChars,
  };
  let raised: EssayIntegrityFlag | null = null;

  if (delta <= 0) return { state: next, raised };

  // A big block in one event with far more chars than keystrokes explains it =>
  // it was inserted, not typed. HARD_JUMP trips regardless of credited keys.
  const unexplained = delta - state.creditsSinceInput;
  if (
    delta >= ESSAY_INTEGRITY.HARD_JUMP ||
    unexplained > ESSAY_INTEGRITY.MAX_UNTYPED_JUMP
  ) {
    if (!next.flags.includes(ESSAY_INTEGRITY_FLAG.BURST_INSERT)) {
      raised = ESSAY_INTEGRITY_FLAG.BURST_INSERT;
    }
    next = withFlag(next, ESSAY_INTEGRITY_FLAG.BURST_INSERT);
  }

  // Sustained inhuman speed across the window (even if each event is small).
  if (windowChars >= ESSAY_INTEGRITY.BURST_CHARS) {
    if (!next.flags.includes(ESSAY_INTEGRITY_FLAG.FAST_TYPING)) {
      raised = raised ?? ESSAY_INTEGRITY_FLAG.FAST_TYPING;
    }
    next = withFlag(next, ESSAY_INTEGRITY_FLAG.FAST_TYPING);
  }

  return { state: next, raised };
}

// ---------------------------------------------------------------------------
// Proctoring warning policy — mirrors the exam runner (shared EXAM_MAX_WARNINGS).
// ---------------------------------------------------------------------------

export interface EssayWarningOutcome {
  /** Attempt is flagged for review (warnings crossed the allowed limit). */
  malpractice: boolean;
  /** The attempt should be force-submitted now (same trigger as malpractice). */
  autoSubmit: boolean;
}

/**
 * Given the running warning count, decide the outcome — IDENTICAL to the exam
 * policy: warnings up to and including EXAM_MAX_WARNINGS are tolerated; the next
 * one flags malpractice AND auto-submits.
 */
export function essayWarningOutcome(warnings: number): EssayWarningOutcome {
  const crossed = warnings > EXAM_MAX_WARNINGS;
  return { malpractice: crossed, autoSubmit: crossed };
}

/**
 * Server-authoritative RE-derivation of the malpractice flag from the reported
 * signals. The compose surface has no live attempt to count against server-side,
 * so the warning COUNT is necessarily client-reported (and clamped by the submit
 * schema) — but the DERIVED flag is always recomputed here, never trusted from
 * the client. Flagged when warnings crossed the limit OR any advisory integrity
 * flag was raised.
 */
export function deriveEssayMalpractice(
  warnings: number,
  flags: readonly string[],
): boolean {
  return warnings > EXAM_MAX_WARNINGS || flags.length > 0;
}
