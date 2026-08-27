/**
 * The end-to-end interview session flow (Step 34 A1), shared by the college and
 * B2C pages: pre-flight (mic + optional camera) → intake (resume/JD/role) → the
 * runner → the report. Owns the single camera hook so the preview stream is shared
 * between the pre-flight and the runner, and threads the client-side observation
 * summary into the report (never scored).
 */
import type { StartMockInterviewResponse } from "@codeapt/shared";
import { useEffect, useState } from "react";

import type { SessionObservations } from "../../lib/camera-observation.js";
import type { InterviewEngine } from "../../lib/interview-engine.js";
import { useCameraObservation } from "../../lib/use-camera-observation.js";
import { useInterviewAvatar } from "../../lib/use-interview-avatar.js";
import { Alert } from "../ui/alert.js";
import { InterviewIntake, type IntakeValues } from "./InterviewIntake.js";
import { InterviewPreflight } from "./InterviewPreflight.js";
import { InterviewResults } from "./InterviewResults.js";
import { InterviewRunner } from "./InterviewRunner.js";

type Phase = "preflight" | "intake" | "run" | "done";

export function InterviewSession({
  engine,
  start,
  defaultRole,
}: {
  engine: InterviewEngine;
  start: (values: IntakeValues) => Promise<StartMockInterviewResponse>;
  defaultRole: string;
}): JSX.Element {
  const camera = useCameraObservation(true);
  const avatar = useInterviewAvatar(true);
  const [phase, setPhase] = useState<Phase>("preflight");
  const [attempt, setAttempt] = useState<StartMockInterviewResponse | null>(null);
  const [observations, setObservations] = useState<SessionObservations | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load the 3D avatar + neural voice during the intake screen so it's ready
  // before question one (speech-only needs no load). Idempotent.
  useEffect(() => {
    if (phase === "intake") avatar.preload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const begin = async (values: IntakeValues): Promise<void> => {
    setStarting(true);
    setError(null);
    try {
      const res = await start(values);
      setAttempt(res);
      setPhase("run");
    } catch {
      setError("Could not start the interview. Please try again.");
    } finally {
      setStarting(false);
    }
  };

  if (phase === "preflight") {
    return <InterviewPreflight camera={camera} onReady={() => setPhase("intake")} />;
  }
  if (phase === "intake") {
    return (
      <div className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <InterviewIntake defaultRole={defaultRole} onSubmit={(v) => void begin(v)} starting={starting} />
        {avatar.is3d && avatar.loading ? (
          <Alert variant="info">
            Your interviewer avatar is loading in the background ({Math.round(avatar.progress * 100)}%)
            — you can begin whenever you’re ready; it’ll appear when it’s done.
          </Alert>
        ) : null}
        {avatar.failed ? (
          <Alert variant="info">
            The 3D avatar isn’t available on this device — the interview runs with a
            simple avatar and voice. Everything else works normally.
          </Alert>
        ) : null}
      </div>
    );
  }
  if (phase === "run" && attempt) {
    return (
      <InterviewRunner
        engine={engine}
        attempt={attempt}
        camera={camera}
        avatar={avatar}
        onFinished={(obs) => {
          setObservations(obs);
          setPhase("done");
        }}
      />
    );
  }
  if (phase === "done" && attempt) {
    return (
      <InterviewResults engine={engine} attemptId={attempt.attemptId} observations={observations} />
    );
  }
  return <Alert variant="info">Preparing…</Alert>;
}
