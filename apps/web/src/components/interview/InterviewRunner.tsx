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
import { composeSpokenQuestion, fluencyFromEnvelope } from "@codeapt/shared";
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
import {
  aggregateObservations,
  summarizeSessionObservations,
  type AnswerObservation,
  type SessionObservations,
} from "../../lib/camera-observation.js";
import type { UseCameraObservation } from "../../lib/use-camera-observation.js";
import { InterviewTranscript } from "./InterviewTranscript.js";
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
import { parseApiError } from "../../lib/api-client.js";
import { uploadAudioToCloudinary } from "../../lib/audio-upload.js";
import { useAudioRecorder } from "../../lib/use-audio-recorder.js";
import type { UseInterviewAvatar } from "../../lib/use-interview-avatar.js";
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
  avatar,
  onFinished,
}: {
  engine: InterviewEngine;
  attempt: StartMockInterviewResponse;
  camera: UseCameraObservation;
  avatar: UseInterviewAvatar;
  onFinished: (observations: SessionObservations | null) => void;
}): JSX.Element {
  const supported = speechRecognitionSupported(window as never);
  const [state, dispatch] = useReducer(
    interviewReducer,
    INITIAL_INTERVIEW_STATE,
    (init) =>
      interviewReducer(init, { type: "started", current: attempt, greeting: attempt.greeting }),
  );
  // The avatar hook (created in InterviewSession, loaded during intake) is the
  // voice too — greeting/ack/closing are spoken through `avatar.speak`, so the
  // Step-36 conversational flow is preserved by the new voice.
  const voice = avatar;
  const [warnings, setWarnings] = useState(0);
  const [terminated, setTerminated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  // The conversational line the avatar just spoke before the question (greeting on
  // the first turn, then a neutral acknowledgement of the previous answer). F.
  const [spokenPrefix, setSpokenPrefix] = useState("");

  // Conversational glue: greeting (from the start payload), the latest server
  // acknowledgement, and the closing — all spoken, never scored.
  const greetingRef = useRef<string>(attempt.greeting ?? "");
  const ackRef = useRef<string>("");
  const closingRef = useRef<string>("");
  const spokenCountRef = useRef(0);

  const sessionRef = useRef<RecognitionSession>(INITIAL_RECOGNITION_SESSION);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const questionEndedAtRef = useRef<number>(0);
  const firstSpeechAtRef = useRef<number | null>(null);
  const spokenIndexRef = useRef<number>(-1);
  // Per-ANSWER observation summaries + think-times, accumulated across the WHOLE
  // session (Step 36 B — Step 35 kept only the last answer's, so the report was
  // empty). Folded into a session summary at finish.
  const answerObservationsRef = useRef<AnswerObservation[]>([]);
  const finishedRef = useRef(false);
  // The LIVE reducer state, mirrored into a ref so the recorder's onUpload
  // callback (whose identity is stable across turns) always reads the CURRENT
  // turn index + attemptId — never the stale value captured at first render.
  const stateRef = useRef(state);
  stateRef.current = state;

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
        // Read the LIVE turn from the ref — the closure identity is stable across
        // turns, so `state` captured here would be turn 0 forever (the bug).
        const live = stateRef.current.current;
        if (submittingRef.current || !live?.turn) return;
        submittingRef.current = true;
        stopTurnRecognition();
        dispatch({ type: "answer_submitting" });
        const attemptId = live.attemptId;
        const turnIndex = live.currentIndex;
        // Close this answer's observation window + record its think-time. Kept
        // per answer (accumulated) so the report reflects the WHOLE session.
        const observation = camera.granted ? camera.endSampling() : aggregateObservations([]);
        const latencySeconds =
          firstSpeechAtRef.current !== null
            ? Math.max(0, (firstSpeechAtRef.current - questionEndedAtRef.current) / 1000)
            : null;
        answerObservationsRef.current.push({ index: turnIndex, summary: observation, latencySeconds });
        const latencyMs =
          firstSpeechAtRef.current !== null
            ? firstSpeechAtRef.current - questionEndedAtRef.current
            : 0;
        try {
          const audioUrl = await uploadAudioToCloudinary(engine.uploadSignature, blob);
          const capture = await captureBrowserResult(blob);
          const res = await engine.submitAnswer(attemptId, turnIndex, {
            audioUrl,
            transcript: capture.transcript,
            fluency: capture.fluency,
            recognitionFailed: capture.recognitionFailed,
            latencySeconds: Math.max(0, latencyMs / 1000),
          });
          // Conversational glue for the next spoken line (F): the acknowledgement
          // precedes the next question; the closing plays when the interview ends.
          ackRef.current = res.acknowledgement ?? "";
          closingRef.current = res.closing ?? "";
          dispatch({ type: "answered", response: res, answerText: capture.transcript });
        } catch (err) {
          // The submit was rejected. NOT_CURRENT_TURN means our index is stale —
          // RE-SYNC from the server's authoritative `current` and continue (never
          // blindly re-submit the same index; never spin forever). Anything else
          // is surfaced as an error, exiting the "thinking" state.
          const code = parseApiError(err).code;
          if (code === "NOT_CURRENT_TURN") {
            try {
              const fresh = await engine.current(attemptId);
              spokenIndexRef.current = -1; // allow the resynced turn to be re-asked
              dispatch({ type: "resynced", current: fresh });
            } catch {
              setError("We lost sync with the interview. Please refresh to continue.");
            }
          } else if (code === "ATTEMPT_EXPIRED") {
            setError("This interview's time has expired.");
          } else {
            setError("We couldn't submit that answer. Check your connection and try again.");
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
  // A reason is recorded for camera "frame changed" signals (Step 35 B); the DOM
  // proctoring hook fires without one. Both ride the SAME warning machinery.
  const doWarning = useCallback(
    (reason?: string) => {
      void engine
        .recordWarning(attempt.attemptId, reason)
        .then((res) => {
          setWarnings(res.warnings);
          if (res.terminated) {
            setTerminated(true);
            recorder.stop();
            onFinished(summarizeSessionObservations(answerObservationsRef.current));
          }
        })
        .catch(() => setWarnings((n) => n + 1));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, attempt.attemptId],
  );
  const onWarning = useCallback(() => doWarning(), [doWarning]);

  // Person-change (Part B): a second face, or a face that left and returned, is a
  // proctoring warning through the same path — detected, NOT identified.
  const lastPersonSeqRef = useRef(0);
  useEffect(() => {
    const sig = camera.personSignal;
    if (!sig || sig.seq === lastPersonSeqRef.current) return;
    lastPersonSeqRef.current = sig.seq;
    if (state.finished || terminated) return; // no warnings once the interview is over
    doWarning(sig.reason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.personSignal]);
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
    // Wait for the avatar/voice to be ready so the greeting is spoken with lip-sync
    // (speech-only is ready immediately; a failed 3D load degrades to ready too).
    if (!avatar.ready) return;
    if (spokenIndexRef.current === currentTurn.index) return;
    spokenIndexRef.current = currentTurn.index;
    setLiveTranscript("");
    firstSpeechAtRef.current = null;
    const turnIndex = currentTurn.index;
    // First spoken turn → greet; thereafter → acknowledge the previous answer.
    // Each prefix is consumed once so a re-ask (resync) doesn't repeat it.
    const prefix = spokenCountRef.current === 0 ? greetingRef.current : ackRef.current;
    greetingRef.current = "";
    ackRef.current = "";
    spokenCountRef.current += 1;
    setSpokenPrefix(prefix);
    voice.speak(composeSpokenQuestion(prefix, currentTurn.question), {
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
  }, [state.phase, currentTurn?.index, avatar.ready]);

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

  // Finish once — speak the closing line first (F), then hand off to the report.
  useEffect(() => {
    if (state.finished && !finishedRef.current) {
      finishedRef.current = true;
      const closing = closingRef.current;
      if (closing) {
        voice.speak(closing, { onEnd: () => onFinished(summarizeSessionObservations(answerObservationsRef.current)) });
      } else {
        voice.cancel();
        onFinished(summarizeSessionObservations(answerObservationsRef.current));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.finished]);

  // The avatar's UI state (drives TalkingHead mood/gesture, or the static SVG).
  const avatarState: AvatarState =
    state.phase === "asking" || voice.speaking
      ? "speaking"
      : state.phase === "answering"
        ? "listening"
        : state.phase === "thinking"
          ? "thinking"
          : "idle";
  useEffect(() => {
    avatar.setUiState(avatarState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarState]);

  if (!supported) {
    return <Alert variant="error">{SUPPORTED_BROWSERS_MESSAGE}</Alert>;
  }
  if (error) {
    return (
      <div className="space-y-3">
        <Alert variant="error">{error}</Alert>
        <Button variant="secondary" onClick={() => onFinished(summarizeSessionObservations(answerObservationsRef.current))}>
          See your report so far
        </Button>
      </div>
    );
  }
  if (terminated) {
    return (
      <Alert variant="error">
        This interview was ended — unauthorised actions detected. Whatever you
        completed has been scored.
      </Alert>
    );
  }

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
          {avatar.is3d && avatar.avatarVisible ? (
            <div className="relative h-40 w-40 overflow-hidden rounded-2xl bg-surface-muted">
              {/* TalkingHead mounts its canvas here (relocated from intake). */}
              <div ref={avatar.attach} className="absolute inset-0" />
              <span className="pointer-events-none absolute bottom-1 left-0 right-0 text-center text-[11px] text-ink-muted">
                {avatar.speaking ? "Interviewer speaking…" : "Interviewer"}
              </span>
            </div>
          ) : (
            // Static avatar shows immediately; the interview is already running.
            // The 3D avatar (if any) upgrades this in place when it finishes loading.
            <div className="flex flex-col items-center gap-1">
              <InterviewAvatar state={avatarState} pulse={0} />
              {avatar.is3d && avatar.loading ? (
                <span className="flex items-center gap-1 text-[11px] text-ink-muted">
                  <Loader2 className="h-3 w-3 animate-spin" /> 3D avatar loading…{" "}
                  {Math.round(avatar.progress * 100)}%
                </span>
              ) : null}
            </div>
          )}
          <CameraSelfView camera={camera} className="h-28 w-full" />
          {camera.granted ? (
            <p className="text-center text-[11px] text-ink-muted">
              {camera.detecting
                ? "Analysing your presence on-device (never recorded)."
                : "Camera preview only — on-device detection isn’t available here."}
            </p>
          ) : null}
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
                  <p className="text-sm text-ink-muted">
                    {spokenPrefix ? (
                      <span className="italic">“{spokenPrefix}” </span>
                    ) : null}
                    The interviewer is asking…
                  </p>
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

      {/* Persistent conversation transcript (Step 36 A) — greeting, questions,
          acknowledgements and closing, visually distinct and never lost. */}
      {state.messages.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <InterviewTranscript messages={state.messages} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
