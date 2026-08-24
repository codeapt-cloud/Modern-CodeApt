/**
 * useAudioRecorder — the browser side of the pure recorder machine
 * (audio-recorder-machine.ts). Owns getUserMedia, MediaRecorder (Opus/WebM), a
 * live level meter + silence detection (AnalyserNode), the fixed response window
 * with auto-stop, and the direct signed upload. It drives the pure reducer so
 * the state transitions are the ones the machine tests cover.
 *
 * Discipline from the source material: NO re-record, NO going back — a graded
 * item ends at `uploaded` and the runner advances. On an audible stop the hook
 * auto-uploads via the injected `onUpload`; a silent take stops in `silent` and
 * the runner treats the item as attempted (no re-record).
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  isSilentTake,
  recorderReducer,
  type RecorderState,
} from "./audio-recorder-machine.js";

const MIME = "audio/webm";

export interface UseAudioRecorder {
  state: RecorderState;
  /** 0..1 live input level (drives the meter). */
  level: number;
  /** 0..1 PEAK level over the current/just-finished take. Unlike `level` (the
   *  instantaneous frame, which falls back to ~0 once recording stops), this
   *  holds the loudest moment of the whole take — so a pre-flight "sound
   *  detected" check reads it AFTER the take, not the dead live meter. Reset to
   *  0 at the start of each take. */
  peakLevel: number;
  /** Seconds left in the fixed window while recording. */
  remainingSeconds: number;
  requestMic: () => Promise<void>;
  start: () => void;
  stop: () => void;
  /** For the pre-flight test take (never a graded item). */
  reset: () => void;
  /** The last recorded blob (pre-flight playback). */
  blob: Blob | null;
}

export function useAudioRecorder(opts: {
  windowSeconds: number;
  /** Called with the recorded blob on an audible stop; resolve = uploaded. */
  onUpload?: (blob: Blob) => Promise<void>;
}): UseAudioRecorder {
  const [state, dispatch] = useReducer(recorderReducer, "idle");
  const [level, setLevel] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0);
  const [remainingSeconds, setRemaining] = useState(opts.windowSeconds);
  const [blob, setBlob] = useState<Blob | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const peakRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const deadlineRef = useRef<number | null>(null);

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const requestMic = useCallback(async () => {
    dispatch({ type: "REQUEST_MIC" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      dispatch({ type: "MIC_GRANTED" });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      dispatch({
        type:
          name === "NotFoundError" || name === "OverconstrainedError"
            ? "MIC_NO_DEVICE"
            : "MIC_DENIED",
      });
    }
  }, []);

  const finishRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    peakRef.current = 0;
    setPeakLevel(0);
    setBlob(null);
    setRemaining(opts.windowSeconds);
    const rec = new MediaRecorder(stream, { mimeType: MIME });
    recorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      stopMeter();
      const b = new Blob(chunksRef.current, { type: MIME });
      setBlob(b);
      const silent = isSilentTake(peakRef.current);
      dispatch({ type: "STOP", silent });
      if (!silent && opts.onUpload) {
        dispatch({ type: "UPLOAD_START" });
        opts
          .onUpload(b)
          .then(() => dispatch({ type: "UPLOAD_OK" }))
          .catch(() => dispatch({ type: "UPLOAD_FAIL" }));
      }
    };
    rec.start();
    dispatch({ type: "START" });

    // Level meter + silence tracking + fixed-window auto-stop.
    deadlineRef.current = performance.now() + opts.windowSeconds * 1000;
    const analyser = analyserRef.current;
    const buf = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);
    const tick = () => {
      if (analyser) {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
        peakRef.current = Math.max(peakRef.current, peak);
        setLevel(peak);
        setPeakLevel(peakRef.current);
      }
      const left = deadlineRef.current
        ? Math.max(0, (deadlineRef.current - performance.now()) / 1000)
        : 0;
      setRemaining(Math.ceil(left));
      if (left <= 0) {
        finishRecording();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [opts, stopMeter, finishRecording]);

  const stop = useCallback(() => finishRecording(), [finishRecording]);
  const reset = useCallback(() => {
    setBlob(null);
    setLevel(0);
    setRemaining(opts.windowSeconds);
    dispatch({ type: "RESET" });
  }, [opts.windowSeconds]);

  // Cleanup on unmount: stop tracks + close the audio context.
  useEffect(() => {
    return () => {
      stopMeter();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
    };
  }, [stopMeter]);

  return {
    state,
    level,
    peakLevel,
    remainingSeconds,
    requestMic,
    start,
    stop,
    reset,
    blob,
  };
}
