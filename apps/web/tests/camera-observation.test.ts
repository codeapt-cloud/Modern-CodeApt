/**
 * Step 34 Part C — pure tests for the camera-observation aggregation from
 * SYNTHETIC frame data, and the camera-declined path. Asserts the HARD boundary
 * indirectly: the summary is coarse OBSERVATIONS only (look-away %, out-of-frame
 * seconds, movement, geometric smile) — there is no emotion/confidence field to
 * assert because none exists — and declining the camera yields `available:false`
 * with nothing that could feed a score.
 */
import { describe, expect, it } from "vitest";

import {
  aggregateObservations,
  isLookingAway,
  mouthAspectRatio,
  smilePresent,
  type FrameObservation,
} from "../src/lib/camera-observation.js";
import {
  interviewPreflightReady,
  observationsEnabled,
} from "../src/lib/interview-preflight.js";

const frame = (over: Partial<FrameObservation> = {}): FrameObservation => ({
  t: 0,
  box: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 },
  mouth: null,
  ...over,
});

describe("coarse head direction (never gaze)", () => {
  it("centre box = looking at camera; a large horizontal offset = looking away", () => {
    expect(isLookingAway({ cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 })).toBe(false);
    expect(isLookingAway({ cx: 0.85, cy: 0.5, w: 0.3, h: 0.4 })).toBe(true);
    expect(isLookingAway(null)).toBe(false);
  });
});

describe("geometric smile (mouth aspect ratio, not emotion)", () => {
  it("a wide mouth relative to eye distance reads as a smile; a narrow one does not", () => {
    const wide = { leftX: 0.4, leftY: 0.6, rightX: 0.6, rightY: 0.6, interocular: 0.3 };
    const narrow = { leftX: 0.47, leftY: 0.6, rightX: 0.53, rightY: 0.6, interocular: 0.3 };
    expect(mouthAspectRatio(wide)).toBeCloseTo(0.667, 2);
    expect(smilePresent(wide)).toBe(true);
    expect(smilePresent(narrow)).toBe(false);
    expect(smilePresent(null)).toBeNull(); // unknown, never fabricated
  });
});

describe("aggregateObservations from synthetic frames", () => {
  it("computes look-away %, out-of-frame seconds, movement, and smile at start/end", () => {
    const frames: FrameObservation[] = [
      frame({ t: 0, box: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 }, mouth: { leftX: 0.4, leftY: 0.6, rightX: 0.6, rightY: 0.6, interocular: 0.3 } }),
      frame({ t: 0.5, box: { cx: 0.9, cy: 0.5, w: 0.3, h: 0.4 } }), // looking away
      frame({ t: 1.0, box: null }), // out of frame
      frame({ t: 1.5, box: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 }, mouth: { leftX: 0.48, leftY: 0.6, rightX: 0.52, rightY: 0.6, interocular: 0.3 } }),
    ];
    const s = aggregateObservations(frames, { frameIntervalSeconds: 0.5 });
    expect(s.available).toBe(true);
    expect(s.frames).toBe(4);
    // 3 face-present frames, 1 of them looking away → 33.3%.
    expect(s.pctLookingAway).toBeCloseTo(33.3, 1);
    expect(s.secondsOutOfFrame).toBe(0.5); // one absent frame × 0.5s
    expect(s.smileAtStart).toBe(true); // wide mouth first
    expect(s.smileAtEnd).toBe(false); // narrow mouth last
    expect(s.movementScore + s.stillnessScore).toBeCloseTo(100, 1);
  });

  it("high frame-to-frame drift reads as more movement than a steady head", () => {
    const steady = [frame({ box: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 } }), frame({ box: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 } })];
    const jittery = [frame({ box: { cx: 0.3, cy: 0.3, w: 0.3, h: 0.4 } }), frame({ box: { cx: 0.7, cy: 0.7, w: 0.3, h: 0.4 } })];
    expect(aggregateObservations(jittery).movementScore).toBeGreaterThan(
      aggregateObservations(steady).movementScore,
    );
  });
});

describe("camera declined / unavailable — nothing to score", () => {
  it("no frames → available:false with zeroed/unknown observations", () => {
    const s = aggregateObservations([]);
    expect(s.available).toBe(false);
    expect(s.frames).toBe(0);
    expect(s.smileAtStart).toBeNull();
    expect(s.smileAtEnd).toBeNull();
    expect(s.secondsOutOfFrame).toBe(0);
  });

  it("declining the camera still lets the interview begin, with observations off", () => {
    const declined = {
      micGranted: true,
      micHasDevice: true,
      cameraChoice: "declined" as const,
    };
    const granted = { ...declined, cameraChoice: "granted" as const };
    // Both are "ready" — declining never blocks the interview (score is identical
    // because observations are feedback, never scored).
    expect(interviewPreflightReady(declined)).toBe(true);
    expect(interviewPreflightReady(granted)).toBe(true);
    expect(observationsEnabled(declined)).toBe(false);
    expect(observationsEnabled(granted)).toBe(true);
  });
});
