/**
 * The interview runner shell (Step 34 A1). Server-driven turn loop over the pure
 * `interviewReducer`. REUSES the Step-32 speaking capture primitives verbatim —
 * `useAudioRecorder` (mic + MediaRecorder), the `browser-stt` recognition reducer
 * (here with interimResults=true for a LIVE transcript), `computeRmsEnvelope` +
 * `fluencyFromEnvelope` for audio-derived fluency, `uploadAudioToCloudinary`, and
 * the hardened `useProctoring` Communication profile with 3-warning termination.
 * The interviewer voice is browser TTS (useInterviewVoice); the optional camera
 * layer samples per answer and never stores a frame. B1: the next MAIN question is
 * primed during the answer so it speaks with no post-submit setup.
 */
import type { FluencyResult, StartMockInterviewResponse } from "@codeapt/shared";
import { fluencyFromEnvelope } from "@codeapt/shared";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  ENVELOPE_FRAME_SECONDS,
  computeRmsEnvelope,
} from "../../lib/audio-envelope.js";

import {
  INITIAL_INTERVIEW_STATE,
  interviewReducer,
} from "../../lib/interview-runner.js";
import type { InterviewEngine } from "../../lib/interview-engine.js";
import type { ObservationSummary } from "../../lib/camera-observation.js";
import type { UseCameraObservation } from "../../lib/use-camera-observation.js";
import {
  SUPPORTED_BROWSERS_MESSAGE,
  speechRecognitionSupported,
} from "../../lib/browser-stt.js";
import {
  INITIAL_RECOGNITION_SESSION,
  recognitionSessionReducer,
  sessionTranscript,
  shouldRestartRecognizer,
  type RecognitionSession,
} from "../../lib/recognition-session.js";
import { uploadAudioToCloudinary } from "../../lib/audio-upload.js";
import { useAudioRecorder } from "../../lib/use-audio-recorder.js";
import { useInterviewVoice } from "../../lib/use-interview-voice.js";
import { requestFullscreen, useProctoring } from "../../lib/use-proctoring.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { InterviewAvatar, type AvatarState } from "./InterviewAvatar.js";
import { CameraSelfView } from "./CameraSelfView.js";

const ANSWER_WINDOW_SECONDS = 120;
const FIRST_SPEECH_LEVEL = 0.04; // level above which we consider the answer started

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export function InterviewRunner({
  engine,
  attempt,
  camera,
  onFinished,
}: {
  engine: InterviewEngine;
  attempt: StartMockInterviewResponse;
  camera: UseCameraObservation;
  onFinished: (observations: ObservationSummary | null) => void;
}): JSX.Element {
  const supported = speechRecognitionSupported(window as never);
  const [state, dispatch] = useReducer(
    interviewReducer,
    INITIAL_INTERVIEW_STATE,
    (init) => interviewReducer(init, { type: "started", current: attempt }),
  );
  const voice = useInterviewVoice();
  const [warnings, setWarnings] = useState(0);
  const [terminated, setTerminated] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");

  const sessionRef = useRef<RecognitionSession>(INITIAL_RECOGNITION_SESSION);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const questionEndedAtRef = useRef<number>(0);
  const firstSpeechAtRef = useRef<number | null>(null);
  const spokenIndexRef = useRef<number>(-1);
  const observationsRef = useRef<ObservationSummary | null>(null);
  const finishedRef = useRef(false);

  const currentTurn = state.current?.turn ?? null;

  // --- Recognition SESSION control (per-turn re-arm + within-turn restart). ---
  const spawnRecognizer = useCallback(() => {
    const Ctor =
      (window as never as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
      (window as never as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: unknown) => {
      const ev = e as { results: ArrayLike<ArrayLike<{ transcript: string }>> };
      let text = "";
      for (let i = 0; i < ev.results.length; i += 1) text += ev.results[i]![0]!.transcript + " ";
      sessionRef.current = recognitionSessionReducer(sessionRef.current, {
        type: "result",
        text: text.trim(),
      });
      setLiveTranscript(sessionTranscript(sessionRef.current));
    };
    rec.onerror = () => {
      // Errors surface as an end; the session decides whether to restart.
    };
    rec.onend = () => {
      sessionRef.current = recognitionSessionReducer(sessionRef.current, { type: "recognizer_end" });
      recognitionRef.current = null;
      // Continuous recognition ends on its own mid-answer — restart while the turn
      // is active so a long answer keeps being transcribed (the Step-34 fix).
      if (shouldRestartRecognizer(sessionRef.current)) {
        try {
          spawnRecognizer();
        } catch {
          /* no-op */
        }
      }
    };
    try {
      rec.start();
    } catch {
      /* already started / not-allowed surfaces via onend */
    }
  }, []);

  const startTurnRecognition = useCallback(
    (index: number) => {
      sessionRef.current = recognitionSessionReducer(sessionRef.current, {
        type: "turn_start",
        index,
      });
      setLiveTranscript("");
      if (supported) spawnRecognizer();
    },
    [supported, spawnRecognizer],
  );

  const stopTurnRecognition = useCallback(() => {
    sessionRef.current = recognitionSessionReducer(sessionRef.current, { type: "turn_stop" });
    try {
      recognitionRef.current?.stop();
    } catch {
      /* no-op */
    }
    recognitionRef.current = null;
  }, []);

  // --- Reused capture glue: decode blob → envelope → fluency + the turn's transcript. ---
  const captureBrowserResult = useCallback(
    async (
      blob: Blob,
    ): Promise<{ transcript: string; fluency: FluencyResult; recognitionFailed: boolean }> => {
      const transcript = sessionTranscript(sessionRef.current);
      let fluency: FluencyResult;
      try {
        const Ctx =
          (window as never as { AudioContext?: typeof AudioContext }).AudioContext ??
          (window as never as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx!();
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        const env = computeRmsEnvelope(buf.getChannelData(0), buf.sampleRate, ENVELOPE_FRAME_SECONDS);
        fluency = fluencyFromEnvelope(env, ENVELOPE_FRAME_SECONDS, transcript);
        void ctx.close();
      } catch {
        fluency = fluencyFromEnvelope([], ENVELOPE_FRAME_SECONDS, transcript);
      }
      return { transcript, fluency, recognitionFailed: transcript.trim() === "" };
    },
    [],
  );

  const submittingRef = useRef(false);
  const recorder = useAudioRecorder({
    windowSeconds: ANSWER_WINDOW_SECONDS,
    onUpload: useCallback(
      async (blob: Blob) => {
        if (submittingRef.current || !state.current?.turn) return;
        submittingRef.current = true;
        stopTurnRecognition();
        dispatch({ type: "answer_submitting" });
        const observation = camera.granted ? camera.endSampling() : null;
        if (observation) observationsRef.current = observation;
        const latencyMs =
          firstSpeechAtRef.current !== null
            ? firstSpeechAtRef.current - questionEndedAtRef.current
            : 0;
        try {
          const audioUrl = await uploadAudioToCloudinary(engine.uploadSignature, blob);
          const capture = await captureBrowserResult(blob);
          const res = await engine.submitAnswer(
            state.current.attemptId,
            state.current.currentIndex,
            {
              audioUrl,
              transcript: capture.transcript,
              fluency: capture.fluency,
              recognitionFailed: capture.recognitionFailed,
              latencySeconds: Math.max(0, latencyMs / 1000),
            },
          );
          dispatch({ type: "answered", response: res });
        } catch {
          // Upload/submit failed — submit a silent answer so the loop advances.
          try {
            const res = await engine.submitAnswer(
              state.current.attemptId,
              state.current.currentIndex,
              { silent: true },
            );
            dispatch({ type: "answered", response: res });
          } catch {
            /* leave in thinking; the reaper/expiry backstops an abandoned attempt */
          }
        } finally {
          submittingRef.current = false;
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [engine, camera, captureBrowserResult],
    ),
  });

  // Request the mic once (permission already granted at pre-flight; no re-prompt).
  useEffect(() => {
    void recorder.requestMic();
    requestFullscreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Proctoring: the hardened Communication profile, 3-warning server termination.
  const onWarning = useCallback(() => {
    void engine
      .recordWarning(attempt.attemptId)
      .then((res) => {
        setWarnings(res.warnings);
        if (res.terminated) {
          setTerminated(true);
          recorder.stop();
          onFinished(observationsRef.current);
        }
      })
      .catch(() => setWarnings((n) => n + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, attempt.attemptId]);
  useProctoring({
    active: !state.finished && !terminated,
    onWarning,
    block: {
      copy: true,
      cut: true,
      paste: true,
      contextmenu: true,
      drag: true,
      shortcuts: true,
      devtools: true,
      selection: true,
    },
    warnOnPaste: true,
    guardUnload: true,
  });

  // Speak each question once when it becomes current; on end → student answers.
  // The recorder is single-shot (uploaded is terminal), so RE-ARM it each turn
  // with reset()→start() (mirrors the speaking runner's per-item reset) — without
  // this the recorder stays stuck at `uploaded` and turn 2+ records nothing.
  useEffect(() => {
    if (state.phase !== "asking" || !currentTurn) return;
    if (spokenIndexRef.current === currentTurn.index) return;
    spokenIndexRef.current = currentTurn.index;
    setLiveTranscript("");
    firstSpeechAtRef.current = null;
    const turnIndex = currentTurn.index;
    voice.speak(currentTurn.question, {
      onEnd: () => {
        questionEndedAtRef.current = performance.now();
        dispatch({ type: "question_spoken" });
        if (camera.granted) camera.beginSampling();
        recorder.reset();
        recorder.start();
        startTurnRecognition(turnIndex);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, currentTurn?.index]);

  // B1: prime the next MAIN question's TTS during the answer.
  useEffect(() => {
    if (state.phase === "answering" && state.prefetched && !state.prefetchSynthesized) {
      voice.prime(state.prefetched.question);
      dispatch({ type: "prefetch_synthesized" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.prefetched, state.prefetchSynthesized]);

  // Stop any live recogniser on unmount (per-turn start/stop is driven above).
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* no-op */
      }
    };
  }, []);

  // Response-latency: mark the first moment the student's audio rises above silence.
  useEffect(() => {
    if (
      state.phase === "answering" &&
      firstSpeechAtRef.current === null &&
      recorder.level > FIRST_SPEECH_LEVEL
    ) {
      firstSpeechAtRef.current = performance.now();
    }
  }, [state.phase, recorder.level]);

  // Finish once.
  useEffect(() => {
    if (state.finished && !finishedRef.current) {
      finishedRef.current = true;
      voice.cancel();
      onFinished(observationsRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.finished]);

  if (!supported) {
    return <Alert variant="error">{SUPPORTED_BROWSERS_MESSAGE}</Alert>;
  }
  if (terminated) {
    return (
      <Alert variant="error">
        This interview was ended — unauthorised actions detected. Whatever you
        completed has been scored.
      </Alert>
    );
  }

  const avatarState: AvatarState =
    state.phase === "asking" || voice.speaking
      ? "speaking"
      : state.phase === "answering"
        ? "listening"
        : state.phase === "thinking"
          ? "thinking"
          : "idle";
  const answering = state.phase === "answering" && recorder.state === "recording";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="neutral">
          Question {Math.min(state.current!.currentIndex + 1, state.current!.totalTurns)} of{" "}
          {state.current!.totalTurns}
          {state.followUpsSeen > 0 ? ` · ${state.followUpsSeen} follow-up(s)` : ""}
        </Badge>
        {warnings > 0 ? (
          <Badge variant="warning">{warnings} warning(s) — 3 ends the interview</Badge>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <InterviewAvatar state={avatarState} pulse={voice.pulse} />
          <CameraSelfView camera={camera} className="h-28 w-full" />
        </div>

        <Card>
          <CardContent className="space-y-4 p-6">
            {currentTurn ? (
              <>
                <div>
                  {currentTurn.isFollowUp ? (
                    <Badge variant="neutral">follow-up</Badge>
                  ) : (
                    <Badge variant="neutral">{currentTurn.category}</Badge>
                  )}
                  <p className="mt-2 text-lg font-medium text-ink">{currentTurn.question}</p>
                </div>

                {state.phase === "asking" ? (
                  <p className="text-sm text-ink-muted">The interviewer is asking…</p>
                ) : state.phase === "thinking" ? (
                  <p className="flex items-center gap-2 text-sm text-ink-muted">
                    <Loader2 className="h-4 w-4 animate-spin" /> Thinking about your answer…
                  </p>
                ) : (
                  <>
                    <div className="min-h-16 rounded-xl border border-subtle bg-surface-muted p-3 text-sm text-ink">
                      {liveTranscript || (
                        <span className="text-ink-muted">Listening… your words appear here.</span>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      disabled={!answering}
                      onClick={() => recorder.stop()}
                    >
                      Done answering
                    </Button>
                  </>
                )}
              </>
            ) : (
              <p className="flex items-center gap-2 text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Wrapping up…
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
