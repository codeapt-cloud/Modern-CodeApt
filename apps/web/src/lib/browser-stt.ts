/**
 * Browser Web Speech (STT) support detection + a PURE recognition state machine
 * (Step 32). The React runner drives a live SpeechRecognition instance and feeds
 * its events through this reducer; keeping the lifecycle pure means every failure
 * path is unit-testable in the node web suite (no DOM). Web Speech is Chrome /
 * Edge / Safari only — Firefox has none — so a browser-engine attempt must gate
 * on `speechRecognitionSupported` before it starts (compatibility gating).
 */

/** A minimal window shape so this is testable without a real `window`. */
export interface WindowLike {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

/** True when the browser exposes the Web Speech recognition constructor. */
export function speechRecognitionSupported(win: WindowLike | undefined): boolean {
  if (!win) return false;
  return (
    typeof win.SpeechRecognition !== "undefined" ||
    typeof win.webkitSpeechRecognition !== "undefined"
  );
}

export const SUPPORTED_BROWSERS_MESSAGE =
  "This assessment is scored in your browser and needs Google Chrome, Microsoft Edge, or Safari. Firefox is not supported — please switch browsers to begin.";

export type RecognitionStatus =
  | "idle"
  | "listening"
  | "done" // a final transcript arrived
  | "no_speech" // ended/errored with nothing recognised (audio may still be fine)
  | "denied" // mic/recognition permission refused
  | "error"; // any other recognition error mid-item

export interface RecognitionState {
  status: RecognitionStatus;
  /** Final transcript accumulated so far (may be non-empty even before `done`). */
  transcript: string;
}

export type RecognitionEvent =
  | { type: "start" }
  | { type: "result"; transcript: string }
  | { type: "end" }
  | { type: "error"; error: string };

export const INITIAL_RECOGNITION_STATE: RecognitionState = {
  status: "idle",
  transcript: "",
};

/** Recognition error codes that mean the mic/recognition was refused. */
const DENIED_ERRORS = new Set(["not-allowed", "service-not-allowed"]);

/**
 * Advance the recognition state. Once terminal (done/no_speech/denied/error) it
 * stays put — a late `end`/`error` after a result never downgrades a good take.
 */
export function nextRecognitionState(
  state: RecognitionState,
  event: RecognitionEvent,
): RecognitionState {
  const terminal =
    state.status === "done" ||
    state.status === "denied" ||
    state.status === "error" ||
    state.status === "no_speech";

  switch (event.type) {
    case "start":
      return state.status === "idle"
        ? { status: "listening", transcript: "" }
        : state;
    case "result": {
      const transcript = event.transcript.trim();
      // A result with text wins; an empty result is ignored.
      if (transcript === "") return state;
      return { status: "done", transcript };
    }
    case "end":
      if (terminal) return state;
      // Ended while listening: a transcript already captured → done; else nothing
      // was recognised (but the AUDIO recorded fine → re-scorable server-side).
      return state.transcript.trim() !== ""
        ? { status: "done", transcript: state.transcript.trim() }
        : { status: "no_speech", transcript: "" };
    case "error":
      if (state.status === "done") return state; // a good take already landed
      if (DENIED_ERRORS.has(event.error)) return { status: "denied", transcript: "" };
      if (event.error === "no-speech") return { status: "no_speech", transcript: "" };
      return { status: "error", transcript: state.transcript };
    default:
      return state;
  }
}

/**
 * What to SUBMIT for a browser item given the terminal recognition state. The
 * audio ALWAYS uploads regardless; this only decides transcript vs
 * recognitionFailed. A failed recognition (denied/no_speech/error) submits the
 * AUDIO with recognitionFailed=true so the item is Whisper re-scorable, never
 * scored as a real 0.
 */
export function recognitionSubmission(state: RecognitionState): {
  transcript: string;
  recognitionFailed: boolean;
} {
  if (state.status === "done" && state.transcript.trim() !== "") {
    return { transcript: state.transcript.trim(), recognitionFailed: false };
  }
  return { transcript: "", recognitionFailed: true };
}
