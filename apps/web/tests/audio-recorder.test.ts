/**
 * Pure recorder state machine + mic pre-flight gate logic (Communication A/B).
 * The whole permission → ready → recording → stopped → uploaded flow and every
 * failure mode (permission denied, no device, silence, upload failure), plus the
 * pre-flight ordering, tested with no DOM/MediaRecorder.
 */
import { describe, expect, it } from "vitest";

import {
  canStart,
  isBlocked,
  isDone,
  isSilentTake,
  recorderReducer,
  SILENCE_PEAK_THRESHOLD,
  type RecorderEvent,
  type RecorderState,
} from "../src/lib/audio-recorder-machine.js";
import {
  preflightChecklist,
  preflightGate,
  preflightReady,
  type PreflightChecks,
} from "../src/lib/audio-preflight.js";

/** Drive a sequence of events from a start state. */
function run(start: RecorderState, events: RecorderEvent[]): RecorderState {
  return events.reduce(recorderReducer, start);
}

describe("recorder state machine — happy path", () => {
  it("idle → requesting → ready → recording → stopped → uploading → uploaded", () => {
    expect(
      run("idle", [
        { type: "REQUEST_MIC" },
        { type: "MIC_GRANTED" },
        { type: "START" },
        { type: "STOP", silent: false },
        { type: "UPLOAD_START" },
        { type: "UPLOAD_OK" },
      ]),
    ).toBe("uploaded");
  });

  it("canStart only in ready; isDone only when uploaded", () => {
    expect(canStart("ready")).toBe(true);
    expect(canStart("recording")).toBe(false);
    expect(isDone("uploaded")).toBe(true);
    expect(isDone("stopped")).toBe(false);
  });
});

describe("recorder state machine — failure modes each have a real state", () => {
  it("permission denied", () => {
    expect(
      run("idle", [{ type: "REQUEST_MIC" }, { type: "MIC_DENIED" }]),
    ).toBe("permission_denied");
    expect(isBlocked("permission_denied")).toBe(true);
  });

  it("no input device", () => {
    expect(
      run("idle", [{ type: "REQUEST_MIC" }, { type: "MIC_NO_DEVICE" }]),
    ).toBe("no_device");
    expect(isBlocked("no_device")).toBe(true);
  });

  it("silence detected → silent state (not stopped)", () => {
    expect(
      run("ready", [{ type: "START" }, { type: "STOP", silent: true }]),
    ).toBe("silent");
  });

  it("upload failure → upload_failed", () => {
    expect(
      run("stopped", [{ type: "UPLOAD_START" }, { type: "UPLOAD_FAIL" }]),
    ).toBe("upload_failed");
  });

  it("a denied user can retry mic permission", () => {
    expect(recorderReducer("permission_denied", { type: "REQUEST_MIC" })).toBe(
      "requesting",
    );
  });
});

describe("recorder state machine — no re-record for a graded item", () => {
  it("uploaded ignores START/STOP (only pre-flight RESET moves it)", () => {
    expect(recorderReducer("uploaded", { type: "START" })).toBe("uploaded");
    expect(recorderReducer("uploaded", { type: "RESET" })).toBe("ready");
  });

  it("invalid transitions are no-ops (defensive)", () => {
    expect(recorderReducer("idle", { type: "START" })).toBe("idle");
    expect(recorderReducer("ready", { type: "UPLOAD_OK" })).toBe("ready");
  });
});

describe("isSilentTake", () => {
  it("flags a take that never rose above the silence floor", () => {
    expect(isSilentTake(SILENCE_PEAK_THRESHOLD - 0.001)).toBe(true);
    expect(isSilentTake(0.5)).toBe(false);
  });
});

describe("mic pre-flight gate — ordered requirements", () => {
  const base: PreflightChecks = {
    micGranted: false,
    hasDevice: false,
    testPeakLevel: 0,
    testRecorded: false,
    testPlayedBack: false,
  };

  it("walks the requirements in order", () => {
    expect(preflightGate(base)).toBe("need_permission");
    expect(preflightGate({ ...base, micGranted: true })).toBe("no_device");
    expect(
      preflightGate({ ...base, micGranted: true, hasDevice: true }),
    ).toBe("need_test_recording");
    expect(
      preflightGate({
        ...base,
        micGranted: true,
        hasDevice: true,
        testRecorded: true,
        testPeakLevel: 0, // recorded but silent
      }),
    ).toBe("no_input_detected");
    expect(
      preflightGate({
        ...base,
        micGranted: true,
        hasDevice: true,
        testRecorded: true,
        testPeakLevel: 0.5,
      }),
    ).toBe("need_playback");
  });

  it("ready only when every gate passes", () => {
    const ok: PreflightChecks = {
      micGranted: true,
      hasDevice: true,
      testRecorded: true,
      testPeakLevel: 0.5,
      testPlayedBack: true,
    };
    expect(preflightGate(ok)).toBe("ready");
    expect(preflightReady(ok)).toBe(true);
    // The checklist reflects all five as done.
    expect(preflightChecklist(ok).every((c) => c.done)).toBe(true);
  });
});
