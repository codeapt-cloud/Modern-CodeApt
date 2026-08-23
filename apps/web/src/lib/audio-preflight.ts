/**
 * Pure mic pre-flight gate logic (Communication Sections A/B). The transcripts
 * spend a lot of words on mic failures, so the highest-value UX is catching them
 * BEFORE item 1: permission, a live input level, and a test recording the
 * student plays back. This module is the pure decision layer — the UI wires the
 * real getUserMedia / analyser / playback to it; it has no I/O so it unit-tests
 * directly.
 */
import { SILENCE_PEAK_THRESHOLD } from "./audio-recorder-machine.js";

/** The observable state the pre-flight decision reads. */
export interface PreflightChecks {
  /** Mic permission was granted (getUserMedia resolved). */
  micGranted: boolean;
  /** An input device is present. */
  hasDevice: boolean;
  /** Peak input level (0..1) observed during the test recording. */
  testPeakLevel: number;
  /** The student made a test recording. */
  testRecorded: boolean;
  /** The student played the test recording back. */
  testPlayedBack: boolean;
}

export type PreflightGate =
  | "need_permission"
  | "no_device"
  | "need_test_recording"
  | "no_input_detected"
  | "need_playback"
  | "ready";

/**
 * The FIRST unmet requirement, in order — this is what the UI prompts for next.
 * `ready` means every gate passed and the test may begin. Ordering matters:
 * permission → device → a test take → that take was audible → played back.
 */
export function preflightGate(checks: PreflightChecks): PreflightGate {
  if (!checks.micGranted) return "need_permission";
  if (!checks.hasDevice) return "no_device";
  if (!checks.testRecorded) return "need_test_recording";
  if (checks.testPeakLevel < SILENCE_PEAK_THRESHOLD) return "no_input_detected";
  if (!checks.testPlayedBack) return "need_playback";
  return "ready";
}

/** Convenience: is the student cleared to start the actual test? */
export function preflightReady(checks: PreflightChecks): boolean {
  return preflightGate(checks) === "ready";
}

/** Human copy for each gate (drives the pre-flight card's prompt). */
export const PREFLIGHT_MESSAGE: Record<PreflightGate, string> = {
  need_permission: "Allow microphone access to run the mic check.",
  no_device: "No microphone found. Connect one and retry.",
  need_test_recording: "Record a short test clip so you can check your mic.",
  no_input_detected:
    "We didn't detect any sound in your test clip. Un-mute your mic and record again.",
  need_playback: "Play your test clip back and confirm you can hear yourself.",
  ready: "Your microphone is working. You can begin.",
};

/** A five-item checklist the pre-flight card renders with pass/fail ticks. */
export function preflightChecklist(
  checks: PreflightChecks,
): { label: string; done: boolean }[] {
  return [
    { label: "Microphone permission granted", done: checks.micGranted },
    { label: "Input device connected", done: checks.hasDevice },
    { label: "Test clip recorded", done: checks.testRecorded },
    {
      label: "Sound detected in the test clip",
      done: checks.testRecorded && checks.testPeakLevel >= SILENCE_PEAK_THRESHOLD,
    },
    { label: "Played the test clip back", done: checks.testPlayedBack },
  ];
}
