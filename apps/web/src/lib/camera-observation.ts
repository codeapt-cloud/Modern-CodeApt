/**
 * PURE aggregation for the OPTIONAL camera-observation layer (Step 34 Part C,
 * reworked Step 35 A/B). The capture hook (use-camera-observation.ts) grabs
 * frames, runs the MediaPipe FaceLandmarker on each, DISCARDS every frame, and
 * feeds the per-frame RESULTS here. This module turns landmark geometry into a
 * small observation summary AND runs the person-presence reducer that drives
 * "frame changed" proctoring warnings. DOM-free → unit-tested with synthetic data.
 *
 * HARD BOUNDARY (permanent): OBSERVATIONS only — coarse head DIRECTION (yaw from
 * nose-vs-eye geometry), face PRESENCE + COUNT, movement, and a GEOMETRIC smile
 * (mouth-corner spread vs inter-ocular distance). NO emotion/confidence inference,
 * NO iris/gaze-point tracking, NO face recognition / identity / biometric
 * template. Person-change detects that THE FRAME CHANGED (a second face, or a
 * sustained disappearance then return) — never WHO is in it. Observations are
 * FEEDBACK and are NEVER part of the score.
 */

/** One normalized facial landmark (MediaPipe FaceLandmarker output, x/y in 0..1). */
export interface LandmarkPoint {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

/**
 * FaceMesh landmark indices we read. Documented + stable across MediaPipe
 * FaceLandmarker versions. We use only these five — eyes (for scale + yaw), nose
 * (yaw), and mouth corners (geometric smile). No iris indices are read.
 */
const IDX = {
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  noseTip: 1,
  mouthLeft: 61,
  mouthRight: 291,
} as const;

/** One analysed frame. `box` is the normalized face bounding box (cx,cy,w,h in
 *  0..1); null when no face. `mouth` carries the corner points + inter-ocular
 *  distance for a SCALE-INVARIANT geometric smile ratio. `yaw` is coarse head
 *  DIRECTION (nose offset from the eye midpoint / inter-ocular; never gaze/iris).
 *  `faceCount` is how many faces were in the frame (for person-change). */
export interface FrameObservation {
  readonly t: number; // seconds into the answer
  readonly box: { cx: number; cy: number; w: number; h: number } | null;
  readonly mouth: {
    readonly leftX: number;
    readonly leftY: number;
    readonly rightX: number;
    readonly rightY: number;
    readonly interocular: number;
  } | null;
  readonly yaw: number | null;
  readonly faceCount: number;
  // --- ATTACHMENT POINT (Step 35 A) -------------------------------------------
  // To add one more per-frame observation (e.g. a per-frame openness ratio), add
  // ONE numeric field here, populate it in `frameFromLandmarks`, and add ONE line
  // to `aggregateObservations` (see the `meanPresent` helper) + one cell in
  // InterviewResults. Nothing else needs restructuring. Do NOT add emotion/affect.
}

export interface ObservationSummary {
  /** False when the detector produced nothing usable (or the student declined the
   *  camera) — the UI then says observations are unavailable, and NOTHING is scored. */
  readonly available: boolean;
  readonly frames: number;
  /** % of face-present frames whose coarse head direction is turned away. */
  readonly pctLookingAway: number;
  readonly secondsOutOfFrame: number;
  /** 0..100, higher = more movement (frame-to-frame box-centre displacement). */
  readonly movementScore: number;
  readonly stillnessScore: number;
  /** Geometric smile presence at the first/last usable frame; null = unknown. */
  readonly smileAtStart: boolean | null;
  readonly smileAtEnd: boolean | null;
  /** The most faces seen in any single frame this answer (≥2 ⇒ someone else was
   *  in view at some point). Feedback only; the warning path handles enforcement. */
  readonly maxFaces: number;
}

const LOOK_AWAY_THRESHOLD = 0.18; // |cx-0.5| beyond this = off-centre (box fallback)
const YAW_AWAY_THRESHOLD = 0.35; // |nose-offset / interocular| beyond this = head turned away
const SMILE_RATIO_THRESHOLD = 0.45; // mouthWidth / interocular above this = smiling

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

/**
 * Build a FrameObservation from the FaceLandmarker result for one frame: `faces`
 * is the per-face landmark arrays (its length is the face count). Geometry uses
 * face[0]. Pure — unit-tested with synthetic landmark arrays.
 */
export function frameFromLandmarks(
  faces: readonly (readonly LandmarkPoint[])[],
  t: number,
): FrameObservation {
  const faceCount = faces.length;
  const lm = faces[0];
  if (!lm || lm.length <= IDX.rightEyeOuter) {
    return { t, box: null, mouth: null, yaw: null, faceCount };
  }
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const box = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };

  const le = lm[IDX.leftEyeOuter]!;
  const re = lm[IDX.rightEyeOuter]!;
  const nose = lm[IDX.noseTip]!;
  const ml = lm[IDX.mouthLeft]!;
  const mr = lm[IDX.mouthRight]!;
  const interocular = Math.hypot(re.x - le.x, re.y - le.y);
  const mouth =
    interocular > 0
      ? { leftX: ml.x, leftY: ml.y, rightX: mr.x, rightY: mr.y, interocular }
      : null;
  // Coarse yaw: how far the nose sits from the eye midpoint, in inter-ocular
  // units. A turned head pushes the nose toward one eye. DIRECTION only.
  const yaw = interocular > 0 ? (nose.x - (le.x + re.x) / 2) / interocular : null;
  return { t, box, mouth, yaw, faceCount };
}

/** Coarse head direction, box-only fallback (kept for existing callers/tests). */
export function isLookingAway(
  box: FrameObservation["box"],
  threshold = LOOK_AWAY_THRESHOLD,
): boolean {
  if (!box) return false;
  return Math.abs(box.cx - 0.5) > threshold;
}

/** Frame-level "looking away": prefers the coarse yaw when present, else the
 *  box-centre fallback. */
export function frameLookingAway(f: FrameObservation): boolean {
  if (f.yaw != null && Number.isFinite(f.yaw)) return Math.abs(f.yaw) > YAW_AWAY_THRESHOLD;
  return isLookingAway(f.box);
}

/** GEOMETRIC smile: mouth width normalized by inter-ocular distance, thresholded.
 *  Pure arithmetic on landmark coordinates — NOT an emotion classifier. */
export function mouthAspectRatio(mouth: FrameObservation["mouth"]): number | null {
  if (!mouth || mouth.interocular <= 0) return null;
  const dx = mouth.rightX - mouth.leftX;
  const dy = mouth.rightY - mouth.leftY;
  return Math.sqrt(dx * dx + dy * dy) / mouth.interocular;
}
export function smilePresent(
  mouth: FrameObservation["mouth"],
  threshold = SMILE_RATIO_THRESHOLD,
): boolean | null {
  const ratio = mouthAspectRatio(mouth);
  return ratio === null ? null : ratio >= threshold;
}

/**
 * Aggregate per-frame observations. `frameIntervalSeconds` sizes the out-of-frame
 * total. Returns `available: false` when there are no frames — the camera was
 * declined or the detector was unavailable.
 */
export function aggregateObservations(
  frames: readonly FrameObservation[],
  opts: { frameIntervalSeconds?: number } = {},
): ObservationSummary {
  const interval = opts.frameIntervalSeconds ?? 0.5;
  if (frames.length === 0) {
    return {
      available: false,
      frames: 0,
      pctLookingAway: 0,
      secondsOutOfFrame: 0,
      movementScore: 0,
      stillnessScore: 0,
      smileAtStart: null,
      smileAtEnd: null,
      maxFaces: 0,
    };
  }

  const present = frames.filter((f) => f.box !== null);
  const outOfFrame = frames.length - present.length;
  const lookingAway = present.filter((f) => frameLookingAway(f)).length;

  // Movement = mean centre displacement between consecutive PRESENT frames.
  let disp = 0;
  let pairs = 0;
  for (let i = 1; i < present.length; i += 1) {
    const a = present[i - 1]!.box!;
    const b = present[i]!.box!;
    disp += Math.hypot(b.cx - a.cx, b.cy - a.cy);
    pairs += 1;
  }
  const meanDisp = pairs > 0 ? disp / pairs : 0;
  const movementScore = clamp(round1((meanDisp / 0.1) * 100));

  const withMouth = present.filter((f) => f.mouth !== null);
  const smileAtStart = withMouth.length > 0 ? smilePresent(withMouth[0]!.mouth) : null;
  const smileAtEnd =
    withMouth.length > 0 ? smilePresent(withMouth[withMouth.length - 1]!.mouth) : null;

  const maxFaces = frames.reduce((m, f) => Math.max(m, f.faceCount), 0);

  return {
    available: true,
    frames: frames.length,
    pctLookingAway: present.length > 0 ? round1((lookingAway / present.length) * 100) : 0,
    secondsOutOfFrame: round1(outOfFrame * interval),
    movementScore,
    stillnessScore: round1(100 - movementScore),
    smileAtStart,
    smileAtEnd,
    maxFaces,
  };
}

// ---------------------------------------------------------------------------
// Person-change detection (Step 35 B) — PURE streaming reducer.
// ---------------------------------------------------------------------------
/** What a person-change event means. Both detect that THE FRAME CHANGED, never
 *  identity: `multiple_faces` = ≥2 faces sustained; `left_frame` = the face was
 *  absent for a sustained period and then returned. */
export type PersonChangeReason = "multiple_faces" | "left_frame";

export interface PresenceState {
  readonly consecutiveMulti: number;
  readonly consecutiveAbsent: number;
  readonly sawPresence: boolean;
  /** A sustained absence has occurred; the next present frame fires `left_frame`. */
  readonly awaitingReturn: boolean;
}

export const INITIAL_PRESENCE: PresenceState = {
  consecutiveMulti: 0,
  consecutiveAbsent: 0,
  sawPresence: false,
  awaitingReturn: false,
};

/** Frames of ≥2 faces before `multiple_faces` fires (debounce a 1-frame blip). */
export const MULTI_FACE_FRAMES = 2;
/** Frames of zero faces that count as a sustained disappearance. */
export const ABSENT_FRAMES = 4;

/**
 * Advance the presence reducer by one frame. Returns the next state and AT MOST
 * one event (null when nothing crossed a threshold this frame). Events fire on
 * the CROSSING only, so a steady 2-face view or a long absence does not spam
 * warnings: `multiple_faces` fires once when the multi-face streak first reaches
 * the threshold; `left_frame` fires once when a face RETURNS after a sustained
 * absence. Pure — the hook maps a non-null event to `recordWarning`.
 */
export function presenceReducer(
  state: PresenceState,
  faceCount: number,
  opts: { multiFrames?: number; absentFrames?: number } = {},
): { state: PresenceState; event: PersonChangeReason | null } {
  const multiFrames = opts.multiFrames ?? MULTI_FACE_FRAMES;
  const absentFrames = opts.absentFrames ?? ABSENT_FRAMES;

  const consecutiveMulti = faceCount >= 2 ? state.consecutiveMulti + 1 : 0;
  const consecutiveAbsent = faceCount === 0 ? state.consecutiveAbsent + 1 : 0;
  const present = faceCount >= 1;
  const sawPresence = state.sawPresence || present;

  let event: PersonChangeReason | null = null;
  let awaitingReturn = state.awaitingReturn;

  // A sustained absence, once we'd seen a face, arms a return-fire.
  if (consecutiveAbsent >= absentFrames && sawPresence) awaitingReturn = true;
  // The face returns after that absence → "frame changed".
  if (present && awaitingReturn) {
    event = "left_frame";
    awaitingReturn = false;
  }
  // A second face sustained → fire once on the exact crossing.
  if (event === null && consecutiveMulti === multiFrames) {
    event = "multiple_faces";
  }

  return {
    state: { consecutiveMulti, consecutiveAbsent, sawPresence, awaitingReturn },
    event,
  };
}
