/**
 * Step 32 — pure tests for the BROWSER-STT scoring helpers in @codeapt/shared:
 *   - fluencyFromEnvelope: an RMS envelope → the SAME FluencyResult shape as the
 *     Whisper path (word timings), incl. interior-pause detection and speech rate;
 *   - sanitizeClientFluency: the server's trust boundary — re-derives word/filler
 *     counts from the transcript and REJECTS impossible audio metrics;
 *   - scoreSpeechItemFromClient: reuses the existing pure scorers (no new logic),
 *     injects the audio-derived fluency, and refuses dictation.
 * No I/O, no ASR, no browser — all deterministic.
 */
import {
  MAX_BELIEVABLE_SPEECH_RATE,
  fluencyFromEnvelope,
  sanitizeClientFluency,
  scoreSpeechItemFromClient,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

const FRAME = 0.05; // ENVELOPE_FRAME_SECONDS
const V = 0.5; // a clearly-voiced frame (>= 0.02 silence threshold)
const S = 0.0; // a silent frame

function frames(n: number, level: number): number[] {
  return Array.from({ length: n }, () => level);
}

describe("fluencyFromEnvelope", () => {
  it("empty envelope → zeroed audio metrics, but word/filler counts from transcript", () => {
    const f = fluencyFromEnvelope([], FRAME, "um hello there");
    expect(f.wordCount).toBe(3);
    expect(f.fillerCount).toBe(1); // "um"
    expect(f.durationSeconds).toBe(0);
    expect(f.speechRate).toBe(0);
    expect(f.pauseCount).toBe(0);
    expect(f.longestPauseSeconds).toBe(0);
    expect(f.fillerRate).toBeCloseTo(1 / 3, 2);
  });

  it("interior silence longer than the pause threshold counts as ONE pause", () => {
    // 10 voiced (0.5s) | 12 silent (0.6s > 0.5s threshold) | 10 voiced (0.5s).
    const env = [...frames(10, V), ...frames(12, S), ...frames(10, V)];
    // 6 words over 1.0s of spoken (voiced) time → 6 words/sec.
    const f = fluencyFromEnvelope(env, FRAME, "the cat sat on the mat");
    expect(f.pauseCount).toBe(1);
    expect(f.longestPauseSeconds).toBeCloseTo(0.6, 2);
    expect(f.durationSeconds).toBeCloseTo(1.6, 2); // first→last voiced span
    expect(f.speechRate).toBeCloseTo(6, 2); // 6 words / 1.0s voiced
    expect(f.wordCount).toBe(6);
  });

  it("silence SHORTER than the threshold is not a pause", () => {
    // 10 voiced | 8 silent (0.4s < 0.5s) | 10 voiced → no interior pause.
    const env = [...frames(10, V), ...frames(8, S), ...frames(10, V)];
    const f = fluencyFromEnvelope(env, FRAME, "one two three four");
    expect(f.pauseCount).toBe(0);
  });

  it("leading/trailing silence is not a pause and does not extend the span", () => {
    const env = [...frames(6, S), ...frames(10, V), ...frames(6, S)];
    const f = fluencyFromEnvelope(env, FRAME, "alpha beta gamma");
    expect(f.pauseCount).toBe(0);
    expect(f.durationSeconds).toBeCloseTo(0.5, 2); // only the voiced span
  });
});

describe("sanitizeClientFluency — server trust boundary", () => {
  const good = {
    wordCount: 999, // client-claimed — MUST be ignored
    durationSeconds: 8,
    speechRate: 3,
    pauseCount: 2,
    longestPauseSeconds: 1.2,
    fillerCount: 50, // client-claimed — MUST be ignored
    fillerRate: 0.9,
  };

  it("accepts believable metrics and re-derives word/filler counts from transcript", () => {
    const f = sanitizeClientFluency(good, 10, "um so basically hello world");
    expect(f).not.toBeNull();
    expect(f!.wordCount).toBe(5); // NOT 999
    expect(f!.fillerCount).toBe(2); // "um", "basically" — NOT 50
    expect(f!.durationSeconds).toBe(8);
    expect(f!.speechRate).toBe(3);
    expect(f!.pauseCount).toBe(2);
  });

  it("rejects a superhuman speech rate", () => {
    const f = sanitizeClientFluency(
      { ...good, speechRate: MAX_BELIEVABLE_SPEECH_RATE + 1 },
      10,
      "hello world",
    );
    expect(f).toBeNull();
  });

  it("rejects a duration longer than the clip (plus slack)", () => {
    const f = sanitizeClientFluency({ ...good, durationSeconds: 100 }, 10, "hi");
    expect(f).toBeNull();
  });

  it("rejects a pause longer than the clip", () => {
    const f = sanitizeClientFluency(
      { ...good, longestPauseSeconds: 100 },
      10,
      "hi",
    );
    expect(f).toBeNull();
  });

  it("rejects negatives and non-objects", () => {
    expect(sanitizeClientFluency({ ...good, pauseCount: -1 }, 10, "hi")).toBeNull();
    expect(sanitizeClientFluency(null, 10, "hi")).toBeNull();
    expect(sanitizeClientFluency("nope", 10, "hi")).toBeNull();
    expect(
      sanitizeClientFluency({ ...good, durationSeconds: "8" }, 10, "hi"),
    ).toBeNull();
  });
});

describe("scoreSpeechItemFromClient — reuses existing scorers", () => {
  const base = {
    referenceText: "the quick brown fox",
    promptText: "",
    missingWord: "",
    answerSet: [] as string[],
    keyFacts: [] as string[],
  };
  const fluency = fluencyFromEnvelope(
    [...frames(10, V), ...frames(10, V)],
    FRAME,
    "the quick brown fox",
  );

  it("read_aloud (default) scores via scoreReadAloud and injects fluency", () => {
    const r = scoreSpeechItemFromClient(
      { ...base, itemType: "read_aloud" },
      "the quick brown fox",
      fluency,
    );
    expect(r.fluency).toEqual(fluency);
    // scoreReadAloud produced an accuracy-bearing result (identical transcript).
    expect(r.wordAccuracy).toBe(100);
  });

  it("open_topic yields a deterministic floor whose total is the fluency score", () => {
    const r = scoreSpeechItemFromClient(
      { ...base, itemType: "open_topic" },
      "i think that remote work improves focus",
      fluency,
    );
    expect(r.source).toBe("deterministic_floor");
    expect(r.aiRelevance).toBeNull();
    expect(r.total).toBe(r.fluencyScore);
  });

  it("short_answer scores via the answer-set matcher", () => {
    const r = scoreSpeechItemFromClient(
      { ...base, itemType: "short_answer", answerSet: ["paris"] },
      "paris",
      fluency,
    );
    expect(r).toHaveProperty("matched");
  });

  it("dictation is typed and refuses the browser path", () => {
    expect(() =>
      scoreSpeechItemFromClient(
        { ...base, itemType: "dictation" },
        "whatever",
        fluency,
      ),
    ).toThrow();
  });
});
