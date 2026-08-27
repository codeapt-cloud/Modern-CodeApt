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
  frameFromLandmarks,
  frameLookingAway,
  INITIAL_PRESENCE,
  isLookingAway,
  mouthAspectRatio,
  presenceReducer,
  smilePresent,
  type FrameObservation,
  type LandmarkPoint,
  type PersonChangeReason,
  type PresenceState,
} from "../src/lib/camera-observation.js";
import {
  interviewPreflightReady,
  observationsEnabled,
} from "../src/lib/interview-preflight.js";

const frame = (over: Partial<FrameObservation> = {}): FrameObservation => ({
  t: 0,
  box: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 },
  mouth: null,
  yaw: null,
  faceCount: 1,
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

// ---------------------------------------------------------------------------
// Step 35 A: frame geometry from synthetic MediaPipe landmarks.
// ---------------------------------------------------------------------------
describe("frameFromLandmarks — synthetic detections", () => {
  // Build a landmark array big enough to index the highest landmark we read
  // (rightEyeOuter=263), placing the five points we care about.
  const face = (over: {
    leftEye: [number, number];
    rightEye: [number, number];
    nose: [number, number];
    mouthL: [number, number];
    mouthR: [number, number];
  }): LandmarkPoint[] => {
    const pts: LandmarkPoint[] = Array.from({ length: 300 }, () => ({ x: 0.5, y: 0.5 }));
    pts[33] = { x: over.leftEye[0], y: over.leftEye[1] };
    pts[263] = { x: over.rightEye[0], y: over.rightEye[1] };
    pts[1] = { x: over.nose[0], y: over.nose[1] };
    pts[61] = { x: over.mouthL[0], y: over.mouthL[1] };
    pts[291] = { x: over.mouthR[0], y: over.mouthR[1] };
    return pts;
  };

  it("reports faceCount and a null box/yaw when no faces detected", () => {
    const f = frameFromLandmarks([], 2);
    expect(f.faceCount).toBe(0);
    expect(f.box).toBeNull();
    expect(f.yaw).toBeNull();
  });

  it("a centred, forward-facing face reads as present and not looking away", () => {
    const f = frameFromLandmarks(
      [
        face({
          leftEye: [0.42, 0.4],
          rightEye: [0.58, 0.4],
          nose: [0.5, 0.5], // nose centred between the eyes → yaw ≈ 0
          mouthL: [0.45, 0.6],
          mouthR: [0.55, 0.6],
        }),
      ],
      0,
    );
    expect(f.faceCount).toBe(1);
    expect(f.box).not.toBeNull();
    expect(Math.abs(f.yaw!)).toBeLessThan(0.2);
    expect(frameLookingAway(f)).toBe(false);
  });

  it("a turned head (nose pushed toward one eye) reads as looking away via yaw", () => {
    const f = frameFromLandmarks(
      [
        face({
          leftEye: [0.42, 0.4],
          rightEye: [0.58, 0.4],
          nose: [0.57, 0.5], // nose near the right eye → large yaw
          mouthL: [0.45, 0.6],
          mouthR: [0.55, 0.6],
        }),
      ],
      0,
    );
    expect(Math.abs(f.yaw!)).toBeGreaterThan(0.35);
    expect(frameLookingAway(f)).toBe(true);
  });

  it("counts two faces (drives person-change), geometry taken from the first", () => {
    const one = face({
      leftEye: [0.42, 0.4],
      rightEye: [0.58, 0.4],
      nose: [0.5, 0.5],
      mouthL: [0.45, 0.6],
      mouthR: [0.55, 0.6],
    });
    const f = frameFromLandmarks([one, one], 0);
    expect(f.faceCount).toBe(2);
    expect(f.box).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Step 35 B: person-change reducer — drives proctoring warnings.
// ---------------------------------------------------------------------------
describe("presenceReducer — person-change (frame changed, never identity)", () => {
  // Drive the reducer over a synthetic face-count stream the way the capture loop
  // does, collecting the events it emits.
  const run = (counts: number[]): (PersonChangeReason | null)[] => {
    let s: PresenceState = INITIAL_PRESENCE;
    const events: (PersonChangeReason | null)[] = [];
    for (const c of counts) {
      const r = presenceReducer(s, c);
      s = r.state;
      events.push(r.event);
    }
    return events;
  };

  it("fires multiple_faces once when a second face is sustained, not on a 1-frame blip", () => {
    // A single 2-face frame (blip) → nothing; two in a row → one event.
    expect(run([1, 2, 1, 1])).toEqual([null, null, null, null]);
    const ev = run([1, 2, 2, 2, 2]);
    expect(ev.filter((e) => e === "multiple_faces")).toHaveLength(1); // exactly once
  });

  it("fires left_frame when a face disappears for a sustained period then returns", () => {
    // present, then 4 absent frames (sustained), then it returns → one event on return.
    const ev = run([1, 1, 0, 0, 0, 0, 1]);
    expect(ev[6]).toBe("left_frame");
    expect(ev.filter((e) => e === "left_frame")).toHaveLength(1);
    // A brief 1-frame dropout does NOT fire.
    expect(run([1, 0, 1, 1]).every((e) => e === null)).toBe(true);
  });

  it("never fires from a steady single face (no false positives)", () => {
    expect(run([1, 1, 1, 1, 1, 1]).every((e) => e === null)).toBe(true);
  });
});
