/**
 * PURE pre-flight gate for the interview runner (Step 34 A1). Mirrors speaking's
 * audio-preflight but adds the OPTIONAL camera as a first-class, non-blocking
 * choice: the mic is required (no STT without it); the camera is opt-in and
 * declining it is a valid, complete choice — the interview then runs with no
 * observations and NOTHING is missing from the score. DOM-free → unit-tested.
 * (Speaking's audio-preflight is untouched — zero behaviour change there.)
 */
export type CameraChoice = "pending" | "granted" | "declined" | "unavailable";

export interface InterviewPreflightChecks {
  readonly micGranted: boolean;
  readonly micHasDevice: boolean;
  /** The student has made an explicit camera decision (or it isn't available). */
  readonly cameraChoice: CameraChoice;
}

export type InterviewPreflightGate =
  | "need_mic"
  | "no_mic_device"
  | "need_camera_choice"
  | "ready";

/** First unmet requirement, in order. The camera is "unmet" only while the
 *  student hasn't decided yet (`pending`); granted / declined / unavailable all
 *  clear it — declining is a complete choice, never a block. */
export function interviewPreflightGate(
  c: InterviewPreflightChecks,
): InterviewPreflightGate {
  if (!c.micGranted) return "need_mic";
  if (!c.micHasDevice) return "no_mic_device";
  if (c.cameraChoice === "pending") return "need_camera_choice";
  return "ready";
}

export function interviewPreflightReady(c: InterviewPreflightChecks): boolean {
  return interviewPreflightGate(c) === "ready";
}

/** True only when observations will actually be produced (camera granted). */
export function observationsEnabled(c: InterviewPreflightChecks): boolean {
  return c.cameraChoice === "granted";
}

export const INTERVIEW_PREFLIGHT_MESSAGE: Record<InterviewPreflightGate, string> = {
  need_mic: "Allow microphone access — the interview listens to your spoken answers.",
  no_mic_device: "No microphone was found. Connect one and retry.",
  need_camera_choice:
    "Turn the camera on for optional feedback on your presence, or continue without it — your score is the same either way.",
  ready: "You're ready. Begin when you are.",
};

export function interviewPreflightChecklist(
  c: InterviewPreflightChecks,
): { label: string; done: boolean }[] {
  return [
    { label: "Microphone allowed", done: c.micGranted && c.micHasDevice },
    {
      label:
        c.cameraChoice === "granted"
          ? "Camera on (optional feedback)"
          : c.cameraChoice === "declined"
            ? "Continuing without camera"
            : c.cameraChoice === "unavailable"
              ? "Camera unavailable — continuing without it"
              : "Camera decision",
      done: c.cameraChoice !== "pending",
    },
  ];
}
