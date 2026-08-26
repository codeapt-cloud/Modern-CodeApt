/**
 * Step 32 — pure web-lib tests: the Web-Speech recognition state machine (every
 * failure path), what it submits (audio ALWAYS uploads; a failed take still
 * submits so it is Whisper re-scorable), browser-support detection, and the
 * proctoring key-block set. All pure — no DOM, runs in the node web suite.
 */
import { describe, expect, it } from "vitest";

import {
  INITIAL_RECOGNITION_STATE,
  SUPPORTED_BROWSERS_MESSAGE,
  nextRecognitionState,
  recognitionSubmission,
  speechRecognitionSupported,
  type RecognitionState,
} from "../src/lib/browser-stt.js";
import { isBlockedKey, type KeyEventLike } from "../src/lib/proctoring-keys.js";

const start = (s = INITIAL_RECOGNITION_STATE): RecognitionState =>
  nextRecognitionState(s, { type: "start" });

describe("recognition state machine", () => {
  it("start → listening (only from idle)", () => {
    expect(start().status).toBe("listening");
    // start on a non-idle state is a no-op.
    const listening = start();
    expect(nextRecognitionState(listening, { type: "start" })).toBe(listening);
  });

  it("a non-empty result → done with the trimmed transcript", () => {
    const s = nextRecognitionState(start(), {
      type: "result",
      transcript: "  hello world  ",
    });
    expect(s.status).toBe("done");
    expect(s.transcript).toBe("hello world");
  });

  it("an empty result is ignored (stays listening)", () => {
    const listening = start();
    expect(nextRecognitionState(listening, { type: "result", transcript: "   " })).toBe(
      listening,
    );
  });

  it("end while listening with NOTHING recognised → no_speech (audio still fine)", () => {
    const s = nextRecognitionState(start(), { type: "end" });
    expect(s.status).toBe("no_speech");
    expect(s.transcript).toBe("");
  });

  it("end after a captured transcript → done", () => {
    const withText = nextRecognitionState(start(), {
      type: "result",
      transcript: "the answer",
    });
    const s = nextRecognitionState(withText, { type: "end" });
    expect(s.status).toBe("done");
    expect(s.transcript).toBe("the answer");
  });

  it("not-allowed / service-not-allowed → denied", () => {
    expect(
      nextRecognitionState(start(), { type: "error", error: "not-allowed" }).status,
    ).toBe("denied");
    expect(
      nextRecognitionState(start(), { type: "error", error: "service-not-allowed" })
        .status,
    ).toBe("denied");
  });

  it("no-speech error → no_speech", () => {
    expect(
      nextRecognitionState(start(), { type: "error", error: "no-speech" }).status,
    ).toBe("no_speech");
  });

  it("any other error mid-item → error", () => {
    expect(
      nextRecognitionState(start(), { type: "error", error: "network" }).status,
    ).toBe("error");
  });

  it("a late error/end never downgrades a good take", () => {
    const done = nextRecognitionState(start(), {
      type: "result",
      transcript: "kept",
    });
    expect(nextRecognitionState(done, { type: "error", error: "network" })).toBe(done);
    expect(nextRecognitionState(done, { type: "end" }).status).toBe("done");
  });
});

describe("recognitionSubmission — audio always uploads", () => {
  it("a good take submits the transcript, recognitionFailed=false", () => {
    const done = nextRecognitionState(start(), {
      type: "result",
      transcript: "spoken answer",
    });
    expect(recognitionSubmission(done)).toEqual({
      transcript: "spoken answer",
      recognitionFailed: false,
    });
  });

  it.each(["no_speech", "denied", "error"] as const)(
    "a failed take (%s) submits empty transcript + recognitionFailed=true so it is re-scorable",
    (status) => {
      const failed: RecognitionState = { status, transcript: "" };
      expect(recognitionSubmission(failed)).toEqual({
        transcript: "",
        recognitionFailed: true,
      });
    },
  );
});

describe("speechRecognitionSupported", () => {
  it("true when either constructor is present", () => {
    expect(speechRecognitionSupported({ SpeechRecognition: class {} })).toBe(true);
    expect(speechRecognitionSupported({ webkitSpeechRecognition: class {} })).toBe(
      true,
    );
  });
  it("false when neither is present (Firefox) or window is undefined", () => {
    expect(speechRecognitionSupported({})).toBe(false);
    expect(speechRecognitionSupported(undefined)).toBe(false);
  });
  it("names the supported browsers in the gate message", () => {
    expect(SUPPORTED_BROWSERS_MESSAGE).toMatch(/Chrome/);
    expect(SUPPORTED_BROWSERS_MESSAGE).toMatch(/Edge/);
    expect(SUPPORTED_BROWSERS_MESSAGE).toMatch(/Safari/);
    expect(SUPPORTED_BROWSERS_MESSAGE).toMatch(/Firefox/);
  });
});

describe("isBlockedKey — proctoring key set", () => {
  const key = (over: Partial<KeyEventLike>): KeyEventLike => ({
    key: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  });
  const all = { shortcuts: true, devtools: true };

  it("blocks F12 as devtools", () => {
    expect(isBlockedKey(key({ key: "F12" }), all)).toBe("devtools");
  });
  it("blocks Ctrl+Shift+I/J/C as devtools", () => {
    for (const k of ["i", "j", "c"]) {
      expect(isBlockedKey(key({ key: k, ctrlKey: true, shiftKey: true }), all)).toBe(
        "devtools",
      );
    }
  });
  it("blocks Cmd+Opt+I/J/C as devtools (mac)", () => {
    for (const k of ["i", "j", "c"]) {
      expect(isBlockedKey(key({ key: k, metaKey: true, altKey: true }), all)).toBe(
        "devtools",
      );
    }
  });
  it("blocks Ctrl/Cmd + A/C/X/V as clipboard", () => {
    for (const k of ["a", "c", "x", "v"]) {
      expect(isBlockedKey(key({ key: k, ctrlKey: true }), all)).toBe("clipboard");
      expect(isBlockedKey(key({ key: k, metaKey: true }), all)).toBe("clipboard");
    }
  });
  it("allows ordinary typing and respects the option flags", () => {
    expect(isBlockedKey(key({ key: "a" }), all)).toBeNull(); // no modifier
    expect(isBlockedKey(key({ key: "F12" }), { devtools: false })).toBeNull();
    expect(
      isBlockedKey(key({ key: "c", ctrlKey: true }), { shortcuts: false }),
    ).toBeNull();
  });
});
