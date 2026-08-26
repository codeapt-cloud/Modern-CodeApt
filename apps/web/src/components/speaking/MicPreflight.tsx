/**
 * Microphone pre-flight — one shared gate before the speaking runner, used by
 * both the college and the B2C (global) speaking pages (S30). Extracted verbatim
 * from CollegeSpeakingPage (Step 10) so the two pages don't diverge.
 */
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  PREFLIGHT_MESSAGE,
  preflightChecklist,
  preflightGate,
  preflightReady,
} from "../../lib/audio-preflight.js";
import { RECORDER_MESSAGE, isBlocked } from "../../lib/audio-recorder-machine.js";
import { useAudioRecorder } from "../../lib/use-audio-recorder.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";

export function MicPreflight({
  onReady,
  windowSeconds,
}: {
  onReady: () => void;
  windowSeconds: number;
}): JSX.Element {
  const rec = useAudioRecorder({ windowSeconds });
  const [playedBack, setPlayedBack] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void rec.requestMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checks = {
    micGranted:
      rec.state !== "idle" && rec.state !== "requesting" && !isBlocked(rec.state),
    hasDevice: rec.state !== "no_device",
    testRecorded: rec.blob !== null,
    testPeakLevel: rec.peakLevel,
    testPlayedBack: playedBack,
  };
  const gate = preflightReady(checks);

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-ink-muted" />
          <h2 className="font-medium text-ink">Microphone check</h2>
        </div>
        {isBlocked(rec.state) && (
          <Alert variant="error">
            {RECORDER_MESSAGE[rec.state]}{" "}
            <Button size="sm" variant="ghost" onClick={() => void rec.requestMic()}>
              Retry
            </Button>
          </Alert>
        )}
        <p className="text-sm text-ink-muted">
          {PREFLIGHT_MESSAGE[preflightGate(checks)]}
        </p>
        <ul className="space-y-1 text-sm">
          {preflightChecklist(checks).map((c) => (
            <li key={c.label} className={c.done ? "text-success-fg" : "text-ink-muted"}>
              {c.done ? "✓" : "○"} {c.label}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          {rec.state === "recording" ? (
            <Button variant="secondary" onClick={rec.stop}>
              <Square className="mr-1 h-4 w-4" /> Stop ({rec.remainingSeconds}s)
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={!checks.micGranted}
              onClick={() => {
                setPlayedBack(false);
                rec.reset();
                rec.start();
              }}
            >
              Record test clip
            </Button>
          )}
          {rec.blob && (
            <audio
              ref={audioRef}
              controls
              src={URL.createObjectURL(rec.blob)}
              onPlay={() => setPlayedBack(true)}
            />
          )}
          <Button disabled={!gate} onClick={onReady}>
            Begin
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
