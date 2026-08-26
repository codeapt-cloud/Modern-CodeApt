/**
 * The Speaking runner SHELL — one shell for all eleven item types. It owns the
 * per-item lifecycle chrome (progress, prompt-audio playback + play-limit, the
 * prep countdown, the record control + window countdown + level meter), the
 * proctoring wiring, and the no-re-record/no-back discipline. It is item-agnostic:
 * it looks the renderer + `capture` up in the registry and reads item DATA
 * (prepSeconds, stimulus/prompt audio URLs) — it never switches on itemType.
 *
 * Timing note: unlike the exam/game runners there is NO server-authoritative
 * per-item deadline to re-sync against — a MediaRecorder window is a client
 * media clock by nature (the audio is captured in the browser). The window +
 * prep countdowns therefore tick locally (with the shared nextTick clamp) and
 * auto-stop the recorder; the one-take/no-re-record rule is the integrity
 * mechanism. See the Step-13 report (server-gap section).
 */
import { Loader2, Mic, Square, Volume2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import type { StartSpeakingResponse } from "@codeapt/shared";

import type { SpeakingEngine } from "../../lib/speaking-engine.js";
import { formatClock } from "../../lib/speaking-runner.js";
import { useProctoring } from "../../lib/use-proctoring.js";
import { useSpeakingRunner } from "../../lib/use-speaking-runner.js";
import { RECORDER_MESSAGE, isBlocked } from "../../lib/audio-recorder-machine.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { getSpeakingItemDefinition } from "./renderer-registry.js";

export function SpeakingRunner({
  engine,
  attempt,
  onFinished,
}: {
  engine: SpeakingEngine;
  attempt: StartSpeakingResponse;
  onFinished: () => void;
}): JSX.Element {
  const r = useSpeakingRunner({ engine, attempt, onFinished });
  const [warnings, setWarnings] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Speech proctoring = the SAME shared hook, focus-loss only: tab-switch / blur
  // / fullscreen-exit are always-on when active; paste-blocking is irrelevant.
  // "No audio detected" is NOT a proctoring signal — it lives in the recorder's
  // `silent` state below, so the hook stays untouched.
  useProctoring({
    active: !r.finished,
    onWarning: () => setWarnings((n) => n + 1),
    block: {},
    warnOnPaste: false,
    guardUnload: true,
  });

  const item = r.item;
  const def = item ? getSpeakingItemDefinition(item.itemType) : undefined;

  const playPrompt = useCallback(() => {
    if (!r.canPlayPrompt) return;
    audioRef.current?.play().catch(() => undefined);
    r.notePromptPlayed();
  }, [r]);

  if (r.expired) {
    return (
      <Alert variant="warning">
        This attempt&apos;s time has expired, so no more answers can be recorded.
        Your result for the items you completed will appear shortly.
      </Alert>
    );
  }

  if (!item) {
    return (
      <div className="flex items-center gap-2 text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Finishing…
      </div>
    );
  }

  if (!def) {
    return (
      <Alert variant="warning">
        This item type isn&apos;t playable in this build yet.
      </Alert>
    );
  }

  const { Renderer, capture } = def;
  const promptAudio = item.stimulusAudioUrl || item.promptAudioUrl;
  const locked = r.phase === "submitted" || r.recorder.state === "uploading";
  // A listen-based item with NO audio is unanswerable — its reference is
  // withheld, so there is nothing to respond to. Never present it as recordable
  // (Step 27); block + explain instead. `requiresAudio` is computed per-item on
  // the server (correct for sentence_build with vs without chunks). The publish
  // guard makes this unreachable in a published assessment, so it only guards a
  // draft / mid-flight deletion.
  const audioMissing = item.requiresAudio && !promptAudio;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        {/* Progress + proctoring. */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">
              Item {r.index + 1} of {r.total}
            </span>
            {item.section ? (
              <Badge variant="neutral">{item.section}</Badge>
            ) : null}
          </div>
          {warnings > 0 ? (
            <Badge variant="warning">{warnings} focus warning{warnings > 1 ? "s" : ""}</Badge>
          ) : null}
        </div>

        {/* Prompt / stimulus audio (shell-owned so it can enforce the play limit). */}
        {promptAudio ? (
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={playPrompt} disabled={!r.canPlayPrompt}>
              <Volume2 className="mr-2 h-4 w-4" />
              {r.promptPlaysUsed === 0 ? "Play audio" : "Play again"}
            </Button>
            <span className="text-xs text-ink-muted">
              {item.stimulusPlayLimit === 0
                ? "You can replay this as needed."
                : `${r.promptPlaysUsed}/${item.stimulusPlayLimit} plays used`}
            </span>
            <audio ref={audioRef} src={promptAudio} preload="auto" className="hidden" />
          </div>
        ) : null}

        {audioMissing ? (
          <Alert variant="error">
            This item needs an audio prompt to answer, but none is available — so
            there’s nothing to play. Please tell your faculty. You won’t be
            marked down for skipping it.
            <div className="mt-2">
              <Button size="sm" onClick={() => void r.skipItem()} disabled={locked}>
                Skip this item
              </Button>
            </div>
          </Alert>
        ) : (
          <>
        {/* The per-type stimulus presentation. */}
        <Renderer
          view={item}
          locked={locked}
          recorder={{
            state: r.recorder.state,
            level: r.recorder.level,
            remainingSeconds: r.recorder.remainingSeconds,
            start: r.recorder.start,
            stop: r.recorder.stop,
          }}
          submitText={r.submitText}
        />

        {/* Mic-blocked state (permission / no device). */}
        {isBlocked(r.recorder.state) ? (
          <Alert variant="error">
            {RECORDER_MESSAGE[r.recorder.state]}
            <div className="mt-2">
              <Button size="sm" onClick={() => void r.recorder.requestMic()}>
                Retry microphone
              </Button>
            </div>
          </Alert>
        ) : null}

        {/* Phase-specific capture chrome (audio only; dictation owns its own). */}
        {capture === "audio" && !isBlocked(r.recorder.state) ? (
          <div className="space-y-3">
            {r.phase === "prompt" ? (
              <Button onClick={r.beginResponse}>
                {item.prepSeconds > 0 ? "Start prep" : "Start recording"}
              </Button>
            ) : null}

            {r.phase === "prep" ? (
              <div className="rounded-xl border border-subtle bg-surface-sunken p-4 text-center">
                <div className="text-sm text-ink-muted">Prepare your answer</div>
                <div className="font-mono text-2xl text-ink">
                  {formatClock(r.prepRemaining)}
                </div>
                <div className="mt-1 text-xs text-ink-muted">
                  Recording starts automatically when prep ends.
                </div>
              </div>
            ) : null}

            {r.phase === "responding" && r.recorder.state === "recording" ? (
              <div className="space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${Math.round(r.recorder.level * 100)}%` }}
                  />
                </div>
                <Button variant="secondary" onClick={r.recorder.stop}>
                  <Square className="mr-2 h-4 w-4" />
                  Stop ({r.recorder.remainingSeconds}s)
                </Button>
              </div>
            ) : null}

            {r.phase === "responding" && r.recorder.state === "ready" ? (
              <Button onClick={r.recorder.start}>
                <Mic className="mr-2 h-4 w-4" />
                Record ({item.responseWindowSeconds}s)
              </Button>
            ) : null}

            {r.recorder.state === "uploading" ? (
              <div className="flex items-center gap-2 text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                {RECORDER_MESSAGE.uploading}
              </div>
            ) : null}

            {r.recorder.state === "silent" ? (
              <Alert variant="warning">
                No audio was detected for that answer. Moving on — you can&apos;t re-record.
              </Alert>
            ) : null}
          </div>
        ) : null}
          </>
        )}

        {r.error ? <Alert variant="warning">{r.error}</Alert> : null}

        <p className="text-xs text-ink-muted">
          One take per item — you can&apos;t re-record or go back. Your result will
          appear shortly after you finish.
        </p>
      </CardContent>
    </Card>
  );
}
