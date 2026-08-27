/**
 * Regression test for the Step-34 blocker: speech recognition must work across
 * multiple consecutive turns (the interview stays on one page), including a
 * spliced follow-up, and must survive a mid-answer recogniser `onend` by
 * restarting and ACCUMULATING the transcript — with NO bleed between turns.
 */
import { describe, expect, it } from "vitest";

import {
  INITIAL_RECOGNITION_SESSION,
  recognitionSessionReducer as reduce,
  sessionTranscript,
  shouldRestartRecognizer,
  type RecognitionSession,
} from "../src/lib/recognition-session.js";

/** Drive one turn: start → (partial → end → restart → rest) → stop; return state. */
function runTurn(
  start: RecognitionSession,
  index: number,
  firstHalf: string,
  secondHalf: string,
): { end: RecognitionSession; restarted: boolean } {
  let s = reduce(start, { type: "turn_start", index });
  s = reduce(s, { type: "result", text: firstHalf });
  // The recogniser ends on its own mid-answer.
  s = reduce(s, { type: "recognizer_end" });
  const restarted = shouldRestartRecognizer(s); // the runner would spawn a new one
  // The replacement recogniser picks up the rest.
  s = reduce(s, { type: "result", text: secondHalf });
  s = reduce(s, { type: "turn_stop" });
  return { end: s, restarted };
}

describe("recognition session — across three turns incl. a follow-up", () => {
  it("captures every turn, restarts mid-turn, and never bleeds between turns", () => {
    let s = INITIAL_RECOGNITION_SESSION;

    // Turn 0 (main).
    const t0 = runTurn(s, 0, "I built the", "payment service");
    expect(t0.restarted).toBe(true); // mid-answer end → restart while active
    expect(sessionTranscript(t0.end)).toBe("I built the payment service");
    s = t0.end;

    // Turn 1 (a spliced FOLLOW-UP) — must start clean, no turn-0 text.
    const t1 = runTurn(s, 1, "we measured it", "with tracing dashboards");
    expect(sessionTranscript(t1.end)).toBe("we measured it with tracing dashboards");
    expect(sessionTranscript(t1.end)).not.toContain("payment"); // no bleed
    s = t1.end;

    // Turn 2 (main again) — recognition still works on the third consecutive turn.
    const t2 = runTurn(s, 2, "an index lets", "the planner seek");
    expect(sessionTranscript(t2.end)).toBe("an index lets the planner seek");
    expect(t2.end.turnIndex).toBe(2);
  });

  it("a turn with a single uninterrupted recogniser still captures its text", () => {
    let s = reduce(INITIAL_RECOGNITION_SESSION, { type: "turn_start", index: 0 });
    s = reduce(s, { type: "result", text: "a complete answer" });
    s = reduce(s, { type: "turn_stop" });
    expect(sessionTranscript(s)).toBe("a complete answer");
  });

  it("results are ignored once the turn is stopped (late events can't corrupt it)", () => {
    let s = reduce(INITIAL_RECOGNITION_SESSION, { type: "turn_start", index: 0 });
    s = reduce(s, { type: "result", text: "final answer" });
    s = reduce(s, { type: "turn_stop" });
    const after = reduce(s, { type: "result", text: "stray late words" });
    expect(sessionTranscript(after)).toBe("final answer");
    expect(shouldRestartRecognizer(after)).toBe(false); // inactive → no restart
  });
});
