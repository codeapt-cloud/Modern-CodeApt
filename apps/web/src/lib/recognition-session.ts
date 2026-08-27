/**
 * PURE model of a MULTI-TURN speech-recognition session (Step 34 fix). The
 * interview stays on ONE page across many turns, and the browser
 * SpeechRecognition instance (a) must be re-armed per turn and (b) fires `onend`
 * on its own mid-answer (continuous mode still stops on silence / network), so it
 * must RESTART within a turn while accumulating the transcript across restarts.
 * Modelling this purely lets us pin "recognition works across N turns incl. a
 * follow-up" in a node test; the runner drives a real recogniser through it.
 *
 * (The single-shot `browser-stt` reducer suited speaking's one-item-then-advance
 * flow; a long, multi-turn, single-page interview needs this accumulating one.)
 */
export interface RecognitionSession {
  /** The turn this session belongs to (−1 before any turn). */
  readonly turnIndex: number;
  /** True between the question finishing and the answer being submitted. */
  readonly active: boolean;
  /** Finalized text folded in from recogniser instances that have ended this turn. */
  readonly finalized: string;
  /** The live recogniser's current (possibly interim) text. */
  readonly current: string;
}

export const INITIAL_RECOGNITION_SESSION: RecognitionSession = {
  turnIndex: -1,
  active: false,
  finalized: "",
  current: "",
};

export type RecognitionSessionEvent =
  | { type: "turn_start"; index: number }
  | { type: "result"; text: string } // the live recogniser's full current text
  | { type: "recognizer_end" } // onend — fold `current` into `finalized`
  | { type: "turn_stop" };

const join = (a: string, b: string): string => `${a} ${b}`.trim();

export function recognitionSessionReducer(
  s: RecognitionSession,
  e: RecognitionSessionEvent,
): RecognitionSession {
  switch (e.type) {
    case "turn_start":
      // A fresh turn: no bleed from the previous turn's transcript.
      return { turnIndex: e.index, active: true, finalized: "", current: "" };
    case "result":
      return s.active ? { ...s, current: e.text.trim() } : s;
    case "recognizer_end":
      // The live recogniser stopped: keep what it captured. If the turn is still
      // active the caller spawns a replacement (see shouldRestartRecognizer).
      return { ...s, finalized: join(s.finalized, s.current), current: "" };
    case "turn_stop":
      return { ...s, active: false };
    default:
      return s;
  }
}

/** The transcript so far this turn (finalized restarts + the live text). */
export function sessionTranscript(s: RecognitionSession): string {
  return join(s.finalized, s.current);
}

/** After a recogniser ends, spawn a replacement only while the turn is active. */
export function shouldRestartRecognizer(s: RecognitionSession): boolean {
  return s.active;
}
