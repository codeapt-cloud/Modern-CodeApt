/**
 * OPTIONAL camera-observation capture (Step 34 Part C, reworked Step 35 A/B).
 * Requests a SEPARATE video stream, LAZILY loads the MediaPipe FaceLandmarker
 * (see face-detector.ts — never in the main bundle), and runs one always-on
 * detection loop while the camera is granted. Each tick: run the detector, DISCARD
 * the frame, update the live "in frame" signal, feed the person-presence reducer
 * (→ proctoring warnings), and — while an answer is being sampled — buffer the
 * per-frame observation for aggregation. Nothing is ever uploaded or stored: no
 * frame, no bitmap, no video, no identity.
 *
 * Camera stays OPTIONAL: if the student declines, none of this runs, observations
 * are absent, and the score is identical (proven by the camera-decline test).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { createFaceDetector, type FaceDetector } from "./face-detector.js";
import {
  aggregateObservations,
  INITIAL_PRESENCE,
  presenceReducer,
  type FrameObservation,
  type ObservationSummary,
  type PersonChangeReason,
  type PresenceState,
} from "./camera-observation.js";

const SAMPLE_INTERVAL_MS = 500; // 2 fps — light for feedback, plenty for presence

/** A person-change signal: a monotonically-increasing seq so the consumer can
 *  react to each event (even repeats of the same reason). */
export interface PersonSignal {
  readonly reason: PersonChangeReason;
  readonly seq: number;
}

export interface UseCameraObservation {
  /** True once we've attempted to enable real detection (MediaPipe target). */
  supported: boolean;
  granted: boolean;
  /** True while the detector is loaded and the detection loop is running. */
  detecting: boolean;
  /** Live signal that a face is currently in frame (for the self-view indicator). */
  inFrame: boolean;
  /** Latest person-change event (multiple faces / face left & returned), or null. */
  personSignal: PersonSignal | null;
  error: string | null;
  /** Ref CALLBACK for any <video> self-view. Binds the shared stream whenever an
   *  element mounts — so the SAME stream shows in both the pre-flight and the
   *  runner previews (a single RefObject can only bind one element at a time). */
  attach: (el: HTMLVideoElement | null) => void;
  /** Request the camera once (preflight). Resolves granted/denied. */
  request(): Promise<boolean>;
  /** Start buffering frames for the current answer. */
  beginSampling(): void;
  /** Stop buffering and return the observation summary for the answer. */
  endSampling(): ObservationSummary;
}

export function useCameraObservation(enabled: boolean): UseCameraObservation {
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const framesRef = useRef<FrameObservation[]>([]);
  const samplingRef = useRef(false);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceRef = useRef<PresenceState>(INITIAL_PRESENCE);
  const seqRef = useRef(0);

  const [supported] = useState(true);
  const [granted, setGranted] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [inFrame, setInFrame] = useState(false);
  const [personSignal, setPersonSignal] = useState<PersonSignal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attach = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => undefined);
    }
  }, []);

  // One always-on detection loop while granted: presence + live in-frame every
  // tick, plus per-answer buffering when sampling. detectForVideo needs a
  // monotonic ms timestamp and a video with real dimensions.
  const startLoop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const video = videoElRef.current;
      const det = detectorRef.current;
      if (!video || !det || video.videoWidth === 0) return;
      let frame: FrameObservation;
      try {
        frame = det.detect(video, performance.now(), (performance.now() - startedAtRef.current) / 1000);
      } catch {
        return; // a transient detect error is not evidence of absence — skip
      }
      const nowInFrame = frame.faceCount >= 1;
      setInFrame((prev) => (prev === nowInFrame ? prev : nowInFrame));
      const { state, event } = presenceReducer(presenceRef.current, frame.faceCount);
      presenceRef.current = state;
      if (event) {
        seqRef.current += 1;
        setPersonSignal({ reason: event, seq: seqRef.current });
      }
      if (samplingRef.current) framesRef.current.push(frame);
    }, SAMPLE_INTERVAL_MS);
  }, []);

  const request = useCallback(async (): Promise<boolean> => {
    if (!enabled) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoElRef.current) {
        videoElRef.current.srcObject = stream;
        void videoElRef.current.play().catch(() => undefined);
      }
      setGranted(true);
      // Load the detector lazily; the preview shows regardless of the outcome.
      const det = await createFaceDetector();
      detectorRef.current = det;
      setDetecting(det !== null);
      if (det) startLoop();
      return true;
    } catch {
      setError("Camera access was declined or unavailable.");
      setGranted(false);
      return false;
    }
  }, [enabled, startLoop]);

  const beginSampling = useCallback(() => {
    framesRef.current = [];
    startedAtRef.current = performance.now();
    samplingRef.current = true;
  }, []);

  const endSampling = useCallback((): ObservationSummary => {
    samplingRef.current = false;
    const frames = framesRef.current;
    framesRef.current = [];
    return aggregateObservations(frames, {
      frameIntervalSeconds: SAMPLE_INTERVAL_MS / 1000,
    });
  }, []);

  // Release everything on unmount — the stream/detector never outlive the interview.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      detectorRef.current?.close();
      detectorRef.current = null;
      streamRef.current?.getTracks().forEach((tk) => tk.stop());
      streamRef.current = null;
    };
  }, []);

  return {
    supported,
    granted,
    detecting,
    inFrame,
    personSignal,
    error,
    attach,
    request,
    beginSampling,
    endSampling,
  };
}
