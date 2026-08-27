/**
 * LAZY MediaPipe FaceLandmarker loader (Step 35 A). The whole point: the previous
 * layer used the browser `FaceDetector` (Shape Detection API), which is Chrome-
 * behind-a-flag on most platforms — so it silently no-op'd and the camera "did
 * nothing". This uses MediaPipe Tasks Vision, which runs everywhere via WASM.
 *
 * Library choice — MediaPipe Tasks Vision FaceLandmarker, over face-api.js:
 *   - Bundle: the JS wrapper (~140 KB, its own async chunk) + WASM (~9.5 MB) +
 *     the face_landmarker model (~3.8 MB). face-api.js is ~1 MB of JS PLUS models
 *     and, decisively, ships an EMOTION classifier we must not use — a DPDP
 *     liability by construction. MediaPipe's blendshape classifier is OPT-IN and
 *     we leave it OFF (see below), so no affect surface exists.
 *   - Off the main thread: MediaPipe runs its graph inside the WASM runtime
 *     (SIMD build when available), not on the JS main thread doing pixel work.
 *   - Load time: model + WASM fetch once, then per-frame `detectForVideo` is a
 *     few ms. We sample at 2 fps, not per-rAF, so it's light.
 *
 * LAZY: this module is only ever reached via `import("./face-detector.js")` from
 * the camera hook when a camera-ENABLED interview starts, so none of it (and none
 * of @mediapipe/tasks-vision) enters the main bundle or any other page.
 *
 * SELF-HOSTED assets (no CDN, CSP-clean, offline-safe): the WASM fileset and the
 * model are served from the app's own /mediapipe/ (copied from the npm package +
 * the pinned Google model at build-prep time). Swap MEDIAPIPE_BASE to relocate.
 */
import {
  frameFromLandmarks,
  type FrameObservation,
  type LandmarkPoint,
} from "./camera-observation.js";

/** Base path for the self-hosted WASM fileset + model (served from public/). */
const MEDIAPIPE_BASE = "/mediapipe";

interface LandmarkerResult {
  faceLandmarks?: LandmarkPoint[][];
}
interface LandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): LandmarkerResult;
  close(): void;
}

export interface FaceDetector {
  /** Analyse one video frame → a normalized FrameObservation (frame discarded). */
  detect(video: HTMLVideoElement, timestampMs: number, t: number): FrameObservation;
  close(): void;
}

/**
 * Create a FaceLandmarker-backed detector. Dynamically imports the (heavy)
 * MediaPipe module so it stays out of the main bundle. Resolves null when the
 * runtime can't initialise (asset fetch failed / unsupported) — the caller then
 * shows the preview but reports observations unavailable, and NOTHING is scored.
 */
export async function createFaceDetector(): Promise<FaceDetector | null> {
  try {
    const vision = await import("@mediapipe/tasks-vision");
    const { FaceLandmarker, FilesetResolver } = vision;
    const fileset = await FilesetResolver.forVisionTasks(`${MEDIAPIPE_BASE}/wasm`);
    const landmarker = (await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `${MEDIAPIPE_BASE}/face_landmarker.task`,
      },
      runningMode: "VIDEO",
      // Detect up to two faces so a second person in frame is observable (B).
      numFaces: 2,
      // The blendshape classifier (which includes affect-adjacent categories like
      // smile/brow) is DELIBERATELY LEFT UNWIRED — we compute a GEOMETRIC smile
      // from mouth-corner landmarks instead, and infer NO emotion. Do not enable.
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    })) as unknown as LandmarkerLike;

    return {
      detect(video, timestampMs, t) {
        const res = landmarker.detectForVideo(video, timestampMs);
        const faces = (res.faceLandmarks ?? []) as LandmarkPoint[][];
        // Landmarks are used for geometry only; the frame itself is never kept.
        return frameFromLandmarks(faces, t);
      },
      close() {
        try {
          landmarker.close();
        } catch {
          /* no-op */
        }
      },
    };
  } catch {
    return null;
  }
}
