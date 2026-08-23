/**
 * Pure state machine for the audio recorder (Communication Sections A/B). No
 * DOM, no MediaRecorder, no I/O — so the whole permission → ready → recording →
 * stopped → uploaded flow, plus every failure mode (permission denied, no input
 * device, silence, upload failure), unit-tests with zero mocking. The React hook
 * (`use-audio-recorder.ts`) drives real MediaRecorder events through this
 * reducer; the machine holds no side effects.
 *
 * Design rule from the source material: NO re-record and NO going back — an item
 * ends at `uploaded` and the runner advances. `reset` exists ONLY for the mic
 * pre-flight's test recording (which may be redone), never for a graded item.
 */

export type RecorderState =
  | "idle" // before the mic pre-flight has run
  | "requesting" // asking the browser for mic permission
  | "permission_denied" // the user refused
  | "no_device" // no input device present
  | "ready" // mic granted, awaiting Start
  | "recording"
  | "silent" // recording ended but no audio was ever detected
  | "stopped" // recording ended with audible input; local blob ready
  | "uploading"
  | "uploaded" // hosted URL obtained — terminal for a graded item
  | "upload_failed";

export type RecorderEvent =
  | { type: "REQUEST_MIC" }
  | { type: "MIC_GRANTED" }
  | { type: "MIC_DENIED" }
  | { type: "MIC_NO_DEVICE" }
  | { type: "START" }
  | { type: "STOP"; silent: boolean }
  | { type: "UPLOAD_START" }
  | { type: "UPLOAD_OK" }
  | { type: "UPLOAD_FAIL" }
  | { type: "RESET" }; // pre-flight only

/** A level below this peak (0..1) for the whole take counts as silence. */
export const SILENCE_PEAK_THRESHOLD = 0.02;

/** True when the recorded take never rose above the silence floor. */
export function isSilentTake(peakLevel: number): boolean {
  return peakLevel < SILENCE_PEAK_THRESHOLD;
}

/** The pure transition. Unknown/invalid transitions leave the state unchanged. */
export function recorderReducer(
  state: RecorderState,
  event: RecorderEvent,
): RecorderState {
  switch (state) {
    case "idle":
      return event.type === "REQUEST_MIC" ? "requesting" : state;
    case "requesting":
      if (event.type === "MIC_GRANTED") return "ready";
      if (event.type === "MIC_DENIED") return "permission_denied";
      if (event.type === "MIC_NO_DEVICE") return "no_device";
      return state;
    case "ready":
      return event.type === "START" ? "recording" : state;
    case "recording":
      if (event.type === "STOP") return event.silent ? "silent" : "stopped";
      return state;
    case "stopped":
      if (event.type === "UPLOAD_START") return "uploading";
      if (event.type === "RESET") return "ready";
      return state;
    case "uploading":
      if (event.type === "UPLOAD_OK") return "uploaded";
      if (event.type === "UPLOAD_FAIL") return "upload_failed";
      return state;
    case "silent":
    case "upload_failed":
      // Recoverable dead-ends: the pre-flight (or an explicit retry policy) may
      // reset to ready. A graded item's runner does NOT dispatch RESET here.
      return event.type === "RESET" ? "ready" : state;
    case "uploaded":
      return event.type === "RESET" ? "ready" : state; // reset only in pre-flight
    case "permission_denied":
    case "no_device":
      return event.type === "REQUEST_MIC" ? "requesting" : state;
    default:
      return state;
  }
}

/** Whether Start should be enabled. */
export const canStart = (s: RecorderState): boolean => s === "ready";
/** Whether a recording is in progress (drives the level meter + countdown). */
export const isRecording = (s: RecorderState): boolean => s === "recording";
/** Whether the item is finished and must not be re-recorded. */
export const isDone = (s: RecorderState): boolean => s === "uploaded";
/** A blocking failure the UI must surface with a real path (not a spinner). */
export const isBlocked = (s: RecorderState): boolean =>
  s === "permission_denied" || s === "no_device";

/** Human copy for each state (also used by the pre-flight + item UI). */
export const RECORDER_MESSAGE: Record<RecorderState, string> = {
  idle: "Checking your microphone…",
  requesting: "Allow microphone access to continue.",
  permission_denied:
    "Microphone access was blocked. Enable it in your browser's site settings, then retry.",
  no_device:
    "No microphone was found. Plug one in (or select an input device) and retry.",
  ready: "Ready to record.",
  recording: "Recording…",
  silent:
    "We didn't detect any sound. Check your mic is not muted and try again.",
  stopped: "Recorded. Uploading…",
  uploading: "Uploading your recording…",
  uploaded: "Saved. Your result will appear shortly.",
  upload_failed: "Upload failed. Check your connection and retry.",
};
