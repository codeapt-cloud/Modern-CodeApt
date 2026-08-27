/**
 * OPTIONAL camera-observation capture (Step 34 Part C). Requests a SEPARATE video
 * stream, samples frames while the student answers, runs the browser Shape
 * Detection `FaceDetector` on each frame, DISCARDS every frame immediately, and
 * hands the per-frame RESULTS to the pure `aggregateObservations`. Nothing is ever
 * uploaded or stored — no frame, no bitmap, no video.
 *
 * Detector choice (deliberate, no new dependency): the browser `FaceDetector`
 * (Shape Detection API). Zero bundle cost and — critically — it exposes ONLY a
 * bounding box + coarse landmarks, NO emotion/expression classifier and NO iris,
 * so the DPDP boundary (face presence + coarse head direction + geometric smile
 * only; never emotion, never gaze-point) is satisfied by construction. Where the
 * API is absent (e.g. desktop Firefox/Safari) `supported` is false: the camera
 * preview still shows, observations report "unavailable", and NOTHING is scored.
 * A landmark library would give wider coverage but is a multi-MB download for a
 * feedback-only layer — deferred (see the Step-34 report).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  aggregateObservations,
  type FrameObservation,
  type ObservationSummary,
} from "./camera-observation.js";

const SAMPLE_INTERVAL_MS = 500;

interface DetectedFaceLike {
  boundingBox: { x: number; y: number; width: number; height: number };
  landmarks?: { type: string; locations: { x: number; y: number }[] }[];
}
interface FaceDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedFaceLike[]>;
}

function faceDetectorSupported(): boolean {
  return typeof (window as unknown as { FaceDetector?: unknown }).FaceDetector !== "undefined";
}

/** Map ONE detector result to a normalized FrameObservation, or an absent-face
 *  frame. Landmarks are used for a GEOMETRIC smile only — never emotion. */
function toFrame(
  faces: DetectedFaceLike[],
  t: number,
  vw: number,
  vh: number,
): FrameObservation {
  const face = faces[0];
  if (!face || vw <= 0 || vh <= 0) return { t, box: null, mouth: null };
  const b = face.boundingBox;
  const box = {
    cx: (b.x + b.width / 2) / vw,
    cy: (b.y + b.height / 2) / vh,
    w: b.width / vw,
    h: b.height / vh,
  };
  // Coarse geometric smile: mouth-corner spread vs eye spread. Only when the
  // detector supplied eye + mouth landmarks; otherwise smile is left unknown.
  let mouth: FrameObservation["mouth"] = null;
  const eyes = face.landmarks?.filter((l) => l.type === "eye") ?? [];
  const mouths = face.landmarks?.filter((l) => l.type === "mouth") ?? [];
  const mouthPts = mouths[0]?.locations ?? [];
  if (eyes.length >= 2 && mouthPts.length >= 2) {
    const e0 = eyes[0]!.locations[0]!;
    const e1 = eyes[1]!.locations[0]!;
    const interocular = Math.hypot(e1.x - e0.x, e1.y - e0.y) / vw;
    const left = mouthPts[0]!;
    const right = mouthPts[mouthPts.length - 1]!;
    mouth = {
      leftX: left.x / vw,
      leftY: left.y / vh,
      rightX: right.x / vw,
      rightY: right.y / vh,
      interocular,
    };
  }
  return { t, box, mouth };
}

export interface UseCameraObservation {
  supported: boolean;
  granted: boolean;
  error: string | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  /** Request the camera once (preflight). Resolves granted/denied. */
  request(): Promise<boolean>;
  /** Start sampling frames for the current answer. */
  beginSampling(): void;
  /** Stop sampling and return the observation summary for the answer. */
  endSampling(): ObservationSummary;
}

export function useCameraObservation(enabled: boolean): UseCameraObservation {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetectorLike | null>(null);
  const framesRef = useRef<FrameObservation[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [supported] = useState(faceDetectorSupported);
  const [granted, setGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (): Promise<boolean> => {
    if (!enabled) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      if (supported) {
        const Ctor = (window as unknown as { FaceDetector: new (o?: unknown) => FaceDetectorLike })
          .FaceDetector;
        detectorRef.current = new Ctor({ fastMode: true, maxDetectedFaces: 1 });
      }
      setGranted(true);
      return true;
    } catch {
      setError("Camera access was declined or unavailable.");
      setGranted(false);
      return false;
    }
  }, [enabled, supported]);

  const beginSampling = useCallback(() => {
    if (!granted || !supported || !detectorRef.current) return;
    framesRef.current = [];
    startedAtRef.current = performance.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const video = videoRef.current;
      const det = detectorRef.current;
      if (!video || !det) return;
      const t = (performance.now() - startedAtRef.current) / 1000;
      // detect() reads the live <video> frame directly; we keep NO copy of it.
      void det
        .detect(video)
        .then((faces) => {
          framesRef.current.push(toFrame(faces, t, video.videoWidth, video.videoHeight));
        })
        .catch(() => {
          framesRef.current.push({ t, box: null, mouth: null });
        });
    }, SAMPLE_INTERVAL_MS);
  }, [granted, supported]);

  const endSampling = useCallback((): ObservationSummary => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const frames = framesRef.current;
    framesRef.current = [];
    return aggregateObservations(frames, {
      frameIntervalSeconds: SAMPLE_INTERVAL_MS / 1000,
    });
  }, []);

  // Release the camera on unmount — the stream never outlives the interview.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((tk) => tk.stop());
      streamRef.current = null;
    };
  }, []);

  return { supported, granted, error, videoRef, request, beginSampling, endSampling };
}
