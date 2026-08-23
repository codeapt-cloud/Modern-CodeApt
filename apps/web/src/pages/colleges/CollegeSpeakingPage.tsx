/**
 * College Speaking page (Communication Sections A/B — read-aloud, Step 10). The
 * student picks a published assessment, passes a mic pre-flight, then records
 * each item in a fixed window (no re-record, no going back), and finally polls
 * an asynchronous result: word accuracy (WER + the exact missed/mis-said words)
 * and fluency. The copy NEVER promises an instant score — "your result will
 * appear shortly". Accent/clarity is explicitly NOT scored.
 */
import {
  CollegeFeature,
  checkEntitlement,
  type SpeakingItemView,
  type StartSpeakingResponse,
} from "@codeapt/shared";
import { Loader2, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { uploadAudioToCloudinary } from "../../lib/audio-upload.js";
import {
  PREFLIGHT_MESSAGE,
  preflightChecklist,
  preflightGate,
  preflightReady,
} from "../../lib/audio-preflight.js";
import {
  RECORDER_MESSAGE,
  isBlocked,
  isSilentTake,
} from "../../lib/audio-recorder-machine.js";
import { useAudioRecorder } from "../../lib/use-audio-recorder.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

type Phase = "list" | "preflight" | "run" | "done";

export function CollegeSpeakingPage() {
  const { slug, context } = useCollege();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.COMMUNICATION,
  );
  const [phase, setPhase] = useState<Phase>("list");
  const [attempt, setAttempt] = useState<StartSpeakingResponse | null>(null);

  const list = useQuery(
    () =>
      entitled
        ? api.collegeSpeaking.available(slug)
        : Promise.resolve({ items: [] }),
    [slug, entitled],
  );

  const startAttempt = async (assessmentId: string): Promise<void> => {
    const res = await api.collegeSpeaking.start(slug, assessmentId);
    setAttempt(res);
    setPhase("preflight");
  };

  if (!entitled) {
    return (
      <Alert variant="info">Your college hasn’t enabled Communication yet.</Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Speaking</h1>
        <p className="text-sm text-ink-muted">
          Read-aloud practice. We score word accuracy and fluency — accent and
          clarity are not scored.
        </p>
      </div>

      {phase === "list" && (
        <>
          {list.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (list.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="Nothing assigned yet" description="No speaking assessments are published for your cohort." />
          ) : (
            <div className="space-y-3">
              {list.data?.items.map((a) => (
                <Card key={a.id}>
                  <CardContent className="flex items-center justify-between p-5">
                    <div>
                      <div className="font-medium text-ink">{a.title}</div>
                      <p className="text-sm text-ink-muted">
                        {a.itemCount} item{a.itemCount === 1 ? "" : "s"} ·{" "}
                        {a.maxAttempts === 0
                          ? "unlimited attempts"
                          : `${a.attemptsUsed}/${a.maxAttempts} attempts used`}
                      </p>
                    </div>
                    <Button
                      disabled={a.maxAttempts > 0 && a.attemptsUsed >= a.maxAttempts}
                      onClick={() => void startAttempt(a.id)}
                    >
                      Start
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {phase === "preflight" && (
        <MicPreflight onReady={() => setPhase("run")} windowSeconds={10} />
      )}

      {phase === "run" && attempt && (
        <ItemRunner
          slug={slug}
          attempt={attempt}
          onFinished={() => setPhase("done")}
        />
      )}

      {phase === "done" && attempt && (
        <SpeakingResults slug={slug} attemptId={attempt.attemptId} />
      )}
    </div>
  );
}

// --- Mic pre-flight ---------------------------------------------------------

function MicPreflight({
  onReady,
  windowSeconds,
}: {
  onReady: () => void;
  windowSeconds: number;
}) {
  const rec = useAudioRecorder({ windowSeconds });
  const [playedBack, setPlayedBack] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void rec.requestMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checks = {
    micGranted: rec.state !== "idle" && rec.state !== "requesting" && !isBlocked(rec.state),
    hasDevice: rec.state !== "no_device",
    testRecorded: rec.blob !== null,
    testPeakLevel: rec.blob && !isSilentTake(rec.level) ? 1 : rec.state === "silent" ? 0 : rec.level,
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
            <>
              <audio
                ref={audioRef}
                controls
                src={URL.createObjectURL(rec.blob)}
                onPlay={() => setPlayedBack(true)}
              />
            </>
          )}
          <Button disabled={!gate} onClick={onReady}>
            Begin
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Per-item recorder ------------------------------------------------------

function ItemRunner({
  slug,
  attempt,
  onFinished,
}: {
  slug: string;
  attempt: StartSpeakingResponse;
  onFinished: () => void;
}) {
  const [index, setIndex] = useState(0);
  const item: SpeakingItemView | undefined = attempt.items[index];
  const [error, setError] = useState("");

  const onUpload = useCallback(
    async (blob: Blob) => {
      const url = await uploadAudioToCloudinary(slug, blob);
      await api.collegeSpeaking.submitItem(
        slug,
        attempt.attemptId,
        index,
        url,
      );
    },
    [slug, attempt.attemptId, index],
  );

  const rec = useAudioRecorder({
    windowSeconds: item?.responseWindowSeconds ?? 30,
    onUpload,
  });

  useEffect(() => {
    void rec.requestMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const advance = useCallback(() => {
    if (index + 1 < attempt.items.length) {
      setIndex((i) => i + 1);
      rec.reset();
    } else {
      onFinished();
    }
  }, [index, attempt.items.length, onFinished, rec]);

  // Auto-advance once an item is uploaded (or a silent take is finalized).
  useEffect(() => {
    if (rec.state === "uploaded" || rec.state === "silent") {
      const t = setTimeout(advance, 1200);
      return () => clearTimeout(t);
    }
    if (rec.state === "upload_failed") setError(RECORDER_MESSAGE.upload_failed);
    return undefined;
  }, [rec.state, advance]);

  if (!item) return null;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="text-xs font-medium text-ink-muted">
          Item {index + 1} of {attempt.items.length}
        </div>
        {item.promptText && (
          <p className="text-sm text-ink-muted">{item.promptText}</p>
        )}
        <div className="rounded-xl border border-subtle bg-surface-raised p-5 text-lg leading-8 text-ink">
          {item.referenceText}
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {isBlocked(rec.state) && (
          <Alert variant="error">
            {RECORDER_MESSAGE[rec.state]}{" "}
            <Button size="sm" variant="ghost" onClick={() => void rec.requestMic()}>
              Retry
            </Button>
          </Alert>
        )}

        {/* Live level meter while recording. */}
        {rec.state === "recording" && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full bg-primary transition-[width] duration-75"
              style={{ width: `${Math.round(rec.level * 100)}%` }}
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          {rec.state === "ready" && (
            <Button onClick={rec.start}>
              <Mic className="mr-1 h-4 w-4" /> Record ({item.responseWindowSeconds}s)
            </Button>
          )}
          {rec.state === "recording" && (
            <Button variant="secondary" onClick={rec.stop}>
              <Square className="mr-1 h-4 w-4" /> Stop ({rec.remainingSeconds}s)
            </Button>
          )}
          {(rec.state === "stopped" ||
            rec.state === "uploading" ||
            rec.state === "uploaded" ||
            rec.state === "silent") && (
            <span className="flex items-center gap-2 text-sm text-ink-muted">
              {(rec.state === "stopped" || rec.state === "uploading") && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {RECORDER_MESSAGE[rec.state]}
            </span>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          One take per item — you can’t re-record or go back.
        </p>
      </CardContent>
    </Card>
  );
}

// --- Async results ----------------------------------------------------------

function SpeakingResults({
  slug,
  attemptId,
}: {
  slug: string;
  attemptId: string;
}) {
  const [tick, setTick] = useState(0);
  const q = useQuery(
    () => api.collegeSpeaking.result(slug, attemptId),
    [slug, attemptId, tick],
  );
  // Poll until complete (the score lands seconds after the last item).
  useEffect(() => {
    if (q.data && !q.data.complete) {
      const t = setTimeout(() => setTick((n) => n + 1), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [q.data]);

  if (q.loading && !q.data) return <Skeleton className="h-32 w-full" />;
  const result = q.data;
  if (!result) return <Alert variant="error">Could not load your result.</Alert>;

  return (
    <div className="space-y-4">
      {!result.complete && (
        <Alert variant="info">
          Your result will appear shortly — scoring your recordings…
        </Alert>
      )}
      {result.items.map((it) => (
        <Card key={it.index}>
          <CardContent className="space-y-2 p-5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">Item {it.index + 1}</span>
              <span className="text-sm text-ink-muted">{it.status}</span>
            </div>
            {it.status === "failed" && (
              <Alert variant="warning">
                {it.error ?? "This recording could not be scored."}
              </Alert>
            )}
            {it.score && (
              <div className="space-y-1 text-sm text-ink-secondary">
                <div>
                  Word accuracy:{" "}
                  <span className="font-mono text-ink">{it.score.wordAccuracy}%</span>
                </div>
                <div>
                  Speech rate:{" "}
                  <span className="font-mono">
                    {it.score.fluency.speechRate} words/s
                  </span>{" "}
                  · pauses: {it.score.fluency.pauseCount} · fillers:{" "}
                  {it.score.fluency.fillerCount}
                </div>
                {it.score.missedWords.length > 0 && (
                  <div>Missed: {it.score.missedWords.join(", ")}</div>
                )}
                {it.score.missaidWords.length > 0 && (
                  <div>
                    Mis-said:{" "}
                    {it.score.missaidWords
                      .map((m) => `${m.expected}→${m.heard}`)
                      .join(", ")}
                  </div>
                )}
                {it.score.phoneticMatches.length > 0 && (
                  <div className="text-ink-muted">
                    Accepted as correct (the transcriber spelled a homophone):{" "}
                    {it.score.phoneticMatches
                      .map((m) => `${m.expected}→${m.heard}`)
                      .join(", ")}
                  </div>
                )}
                <div className="text-xs text-ink-muted">
                  Accent and clarity are not scored.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default CollegeSpeakingPage;
