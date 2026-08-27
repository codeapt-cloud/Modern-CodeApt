/**
 * Interview pre-flight (Step 34 A1): microphone REQUIRED, camera OPTIONAL. Reuses
 * the speaking mic recorder for the mic check; the camera is an explicit opt-in
 * whose refusal never blocks the interview (the pure `interviewPreflightGate`
 * treats declined/unavailable as a complete choice). `onReady(observationsOn)`
 * tells the runner whether to run the camera-observation layer.
 */
import { useEffect, useState } from "react";
import { Camera, CameraOff, Check, Mic } from "lucide-react";

import {
  INTERVIEW_PREFLIGHT_MESSAGE,
  interviewPreflightChecklist,
  interviewPreflightGate,
  interviewPreflightReady,
  type CameraChoice,
} from "../../lib/interview-preflight.js";
import { isBlocked } from "../../lib/audio-recorder-machine.js";
import { useAudioRecorder } from "../../lib/use-audio-recorder.js";
import type { UseCameraObservation } from "../../lib/use-camera-observation.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { CameraSelfView } from "./CameraSelfView.js";

export function InterviewPreflight({
  camera,
  onReady,
}: {
  camera: UseCameraObservation;
  onReady: (observationsOn: boolean) => void;
}): JSX.Element {
  const rec = useAudioRecorder({ windowSeconds: 10 });
  const [cameraChoice, setCameraChoice] = useState<CameraChoice>("pending");

  useEffect(() => {
    void rec.requestMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checks = {
    micGranted:
      rec.state !== "idle" && rec.state !== "requesting" && !isBlocked(rec.state),
    micHasDevice: rec.state !== "no_device",
    cameraChoice,
  };
  const gate = interviewPreflightGate(checks);
  const ready = interviewPreflightReady(checks);
  const checklist = interviewPreflightChecklist(checks);

  const enableCamera = async (): Promise<void> => {
    const ok = await camera.request();
    setCameraChoice(ok ? "granted" : "unavailable");
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-ink">Check your setup</h2>

        {isBlocked(rec.state) ? (
          <Alert variant="error">
            Microphone access is blocked. Allow it in your browser and retry.
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={() => void rec.requestMic()}>
                Retry microphone
              </Button>
            </div>
          </Alert>
        ) : (
          <Alert variant="info">{INTERVIEW_PREFLIGHT_MESSAGE[gate]}</Alert>
        )}

        <ul className="space-y-1 text-sm">
          {checklist.map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              <Check
                className={`h-4 w-4 ${c.done ? "text-success-fg" : "text-ink-muted opacity-40"}`}
              />
              <span className={c.done ? "text-ink" : "text-ink-muted"}>{c.label}</span>
            </li>
          ))}
        </ul>

        {/* Optional camera — a live preview the student sees; frames are analysed
            and discarded, never uploaded. Observations are feedback, not scored. */}
        <div className="rounded-xl border border-subtle p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
            <Camera className="h-4 w-4" /> Camera (optional)
          </div>
          {cameraChoice === "granted" ? (
            <CameraSelfView camera={camera} className="h-40 w-full" />
          ) : (
            <p className="text-xs text-ink-muted">
              Turn the camera on for feedback on your presence (looking away,
              out-of-frame time, movement, smile). It never affects your score, and
              no video or image is ever saved.
              {!camera.supported
                ? " On-device face detection isn’t available in this browser, so observations may be limited."
                : ""}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant={cameraChoice === "granted" ? "secondary" : "primary"}
              disabled={cameraChoice === "granted"}
              onClick={() => void enableCamera()}
            >
              <Camera className="mr-1 h-4 w-4" />
              {cameraChoice === "granted" ? "Camera on" : "Turn on camera"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCameraChoice("declined")}
            >
              <CameraOff className="mr-1 h-4 w-4" /> Continue without camera
            </Button>
          </div>
        </div>

        <Button disabled={!ready} onClick={() => onReady(cameraChoice === "granted")}>
          <Mic className="mr-2 h-4 w-4" /> Begin interview
        </Button>
      </CardContent>
    </Card>
  );
}
