/**
 * PURE aggregation for the OPTIONAL camera-observation layer (Step 34 Part C).
 * The capture hook (use-camera-observation.ts) grabs frames, runs a face
 * detector, DISCARDS every frame, and feeds the per-frame RESULTS here. This
 * module turns those into a small observation summary. DOM-free → unit-tested
 * with synthetic frames.
 *
 * HARD BOUNDARY (permanent): OBSERVATIONS only — coarse head DIRECTION (from the
 * face box position), face PRESENCE, movement, and a GEOMETRIC smile (mouth
 * aspect ratio). NO emotion/confidence inference, NO iris/gaze-point tracking.
 * There is deliberately no "confident"/"anxious"/"happy" anywhere. Observations
 * are FEEDBACK and are NEVER part of the score.
 */

/** One analysed frame. `box` is normalized to the frame (cx,cy,w,h in 0..1);
 *  null when no face was detected. `mouth` carries the two mouth-corner points +
 *  an inter-ocular distance for a SCALE-INVARIANT geometric smile ratio; null
 *  when the detector gave no usable landmarks (then smile is reported unknown). */
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
}

export interface ObservationSummary {
  /** False when the detector produced nothing usable (or the student declined the
   *  camera) — the UI then says observations are unavailable, and NOTHING is scored. */
  readonly available: boolean;
  readonly frames: number;
  /** % of face-present frames whose coarse head direction is away from centre. */
  readonly pctLookingAway: number;
  readonly secondsOutOfFrame: number;
  /** 0..100, higher = more movement (frame-to-frame box-centre displacement). */
  readonly movementScore: number;
  readonly stillnessScore: number;
  /** Geometric smile presence at the first/last usable frame; null = unknown. */
  readonly smileAtStart: boolean | null;
  readonly smileAtEnd: boolean | null;
}

const LOOK_AWAY_THRESHOLD = 0.18; // |cx-0.5| beyond this = head turned away (coarse)
const SMILE_RATIO_THRESHOLD = 0.45; // mouthWidth / interocular above this = smiling

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

/** Coarse head direction: horizontal offset of the face-box centre from the frame
 *  centre. This is DIRECTION only (which way the head is turned), never a gaze
 *  point / iris position. */
export function isLookingAway(
  box: FrameObservation["box"],
  threshold = LOOK_AWAY_THRESHOLD,
): boolean {
  if (!box) return false;
  return Math.abs(box.cx - 0.5) > threshold;
}

/** GEOMETRIC smile: mouth width normalized by inter-ocular distance, thresholded.
 *  Pure arithmetic on landmark coordinates — NOT an emotion classifier. */
export function mouthAspectRatio(mouth: FrameObservation["mouth"]): number | null {
  if (!mouth || mouth.interocular <= 0) return null;
  const dx = mouth.rightX - mouth.leftX;
  const dy = mouth.rightY - mouth.leftY;
  const width = Math.sqrt(dx * dx + dy * dy);
  return width / mouth.interocular;
}
export function smilePresent(
  mouth: FrameObservation["mouth"],
  threshold = SMILE_RATIO_THRESHOLD,
): boolean | null {
  const ratio = mouthAspectRatio(mouth);
  return ratio === null ? null : ratio >= threshold;
}

/**
 * Aggregate per-frame observations. `frameIntervalSeconds` sizes the
 * out-of-frame total. Returns `available: false` (all-zero/null) when there are
 * no frames — the camera was declined or the detector was unavailable.
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
    };
  }

  const present = frames.filter((f) => f.box !== null);
  const outOfFrame = frames.length - present.length;
  const lookingAway = present.filter((f) => isLookingAway(f.box)).length;

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
  // 0.1 of the frame per step ≈ a lot of movement → scale to ~100.
  const movementScore = clamp(round1((meanDisp / 0.1) * 100));

  const withMouth = present.filter((f) => f.mouth !== null);
  const smileAtStart = withMouth.length > 0 ? smilePresent(withMouth[0]!.mouth) : null;
  const smileAtEnd =
    withMouth.length > 0 ? smilePresent(withMouth[withMouth.length - 1]!.mouth) : null;

  return {
    available: true,
    frames: frames.length,
    pctLookingAway: present.length > 0 ? round1((lookingAway / present.length) * 100) : 0,
    secondsOutOfFrame: round1(outOfFrame * interval),
    movementScore,
    stillnessScore: round1(100 - movementScore),
    smileAtStart,
    smileAtEnd,
  };
}
