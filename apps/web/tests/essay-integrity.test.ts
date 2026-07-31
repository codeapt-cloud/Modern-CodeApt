/**
 * Keystroke-integrity heuristic + proctoring warning policy (pure, from
 * @codeapt/shared). These are the honest, ADVISORY detectors the proctored
 * essay composer feeds — they FLAG burst / no-keystroke insertion; they don't
 * (and can't) guarantee prevention. The exam warning policy is mirrored exactly.
 */
import {
  ESSAY_INTEGRITY,
  ESSAY_INTEGRITY_FLAG,
  EXAM_MAX_WARNINGS,
  analyzeInput,
  createIntegrityState,
  creditKeystroke,
  deriveEssayMalpractice,
  essayWarningOutcome,
  flagBlockedPaste,
  type IntegrityState,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

/** Simulate one typed character: credit a keystroke, then a +1 input event. */
function typeChar(state: IntegrityState, at: number): IntegrityState {
  const credited = creditKeystroke(state);
  return analyzeInput(credited, {
    prevLen: credited.lastLen,
    nextLen: credited.lastLen + 1,
    now: at,
  }).state;
}

describe("essay keystroke-integrity heuristic", () => {
  it("does NOT flag a normal human-typed stream (one char per keystroke)", () => {
    let state = createIntegrityState();
    let t = 0;
    for (let i = 0; i < 200; i += 1) {
      t += 180; // ~180ms/char — comfortably human
      state = typeChar(state, t);
    }
    expect(state.flags).toEqual([]);
  });

  it("FLAGS a large block inserted in one event with no keystrokes (injection/paste)", () => {
    const state = createIntegrityState();
    const { state: next, raised } = analyzeInput(state, {
      prevLen: 0,
      nextLen: 500, // 500 chars appear at once, zero credited keystrokes
      now: 1000,
    });
    expect(raised).toBe(ESSAY_INTEGRITY_FLAG.BURST_INSERT);
    expect(next.flags).toContain(ESSAY_INTEGRITY_FLAG.BURST_INSERT);
  });

  it("flags a mid-size jump that far outruns the credited keystrokes", () => {
    // Two real keystrokes credited, but the field grows by 40 chars at once.
    let state = createIntegrityState();
    state = creditKeystroke(creditKeystroke(state));
    const { state: next, raised } = analyzeInput(state, {
      prevLen: 0,
      nextLen: 40,
      now: 500,
    });
    expect(raised).toBe(ESSAY_INTEGRITY_FLAG.BURST_INSERT);
    expect(next.flags).toContain(ESSAY_INTEGRITY_FLAG.BURST_INSERT);
  });

  it("does not flag a small correction (a few unbacked chars under the threshold)", () => {
    const state = createIntegrityState();
    const { state: next, raised } = analyzeInput(state, {
      prevLen: 10,
      nextLen: 10 + ESSAY_INTEGRITY.MAX_UNTYPED_JUMP, // exactly at the tolerance
      now: 100,
    });
    expect(raised).toBeNull();
    expect(next.flags).toEqual([]);
  });

  it("flags sustained inhuman speed across a short window", () => {
    // Many small events within BURST_WINDOW_MS with no keystrokes crossing the
    // per-window char budget → fast-typing flag.
    let state = createIntegrityState();
    let raisedFast = false;
    for (let i = 0; i < 10; i += 1) {
      const res = analyzeInput(state, {
        prevLen: state.lastLen,
        nextLen: state.lastLen + 15, // 15 chars * repeated within 1s
        now: 50 + i * 20, // all inside the 1000ms window
      });
      state = res.state;
      if (res.raised === ESSAY_INTEGRITY_FLAG.FAST_TYPING) raisedFast = true;
    }
    expect(state.flags).toContain(ESSAY_INTEGRITY_FLAG.FAST_TYPING);
    expect(raisedFast).toBe(true);
  });

  it("dedupes flags and records a blocked paste", () => {
    let state = createIntegrityState();
    // Two big injections raise burst-insert only once in the list.
    state = analyzeInput(state, { prevLen: 0, nextLen: 300, now: 10 }).state;
    state = analyzeInput(state, {
      prevLen: 300,
      nextLen: 700,
      now: 5000,
    }).state;
    expect(
      state.flags.filter((f) => f === ESSAY_INTEGRITY_FLAG.BURST_INSERT).length,
    ).toBe(1);
    state = flagBlockedPaste(state);
    state = flagBlockedPaste(state); // idempotent
    expect(
      state.flags.filter((f) => f === ESSAY_INTEGRITY_FLAG.BLOCKED_PASTE)
        .length,
    ).toBe(1);
  });

  it("never flags on deletion / shrink events", () => {
    const state = createIntegrityState();
    const { raised, state: next } = analyzeInput(state, {
      prevLen: 500,
      nextLen: 10, // huge shrink (select-all + delete) — not an injection
      now: 100,
    });
    expect(raised).toBeNull();
    expect(next.flags).toEqual([]);
  });
});

describe("essay proctoring warning policy (mirrors the exam runner)", () => {
  it("tolerates warnings up to EXAM_MAX_WARNINGS, then flags + auto-submits", () => {
    for (let w = 1; w <= EXAM_MAX_WARNINGS; w += 1) {
      const o = essayWarningOutcome(w);
      expect(o.malpractice).toBe(false);
      expect(o.autoSubmit).toBe(false);
    }
    const crossed = essayWarningOutcome(EXAM_MAX_WARNINGS + 1);
    expect(crossed.malpractice).toBe(true);
    expect(crossed.autoSubmit).toBe(true);
  });

  it("re-derives malpractice from warnings OR any advisory flag", () => {
    expect(deriveEssayMalpractice(0, [])).toBe(false);
    expect(deriveEssayMalpractice(EXAM_MAX_WARNINGS, [])).toBe(false);
    expect(deriveEssayMalpractice(EXAM_MAX_WARNINGS + 1, [])).toBe(true);
    // A single advisory flag is enough to flag for review, even at 0 warnings.
    expect(deriveEssayMalpractice(0, ["burst-insert"])).toBe(true);
  });
});
