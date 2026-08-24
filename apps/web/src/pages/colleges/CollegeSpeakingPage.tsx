/**
 * College Speaking page (Communication Sections A/B). The student picks a
 * published assessment, passes a mic pre-flight ONCE, then runs every item
 * through the generalized runner shell (all eleven item types via the renderer
 * registry — no re-record, no going back), and finally polls an asynchronous
 * result. The copy NEVER promises an instant score — "your result will appear
 * shortly". Accent/clarity is explicitly NOT scored.
 *
 * Step 13 generalized this page: the per-item recorder + results were extracted
 * into components/speaking/{SpeakingRunner,SpeakingResults} behind the renderer
 * registry; the list + mic pre-flight below are unchanged from Step 10.
 */
import {
  CollegeFeature,
  checkEntitlement,
  type StartSpeakingResponse,
} from "@codeapt/shared";
import { Mic, Settings2, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { SpeakingResults } from "../../components/speaking/SpeakingResults.js";
import { SpeakingRunner } from "../../components/speaking/SpeakingRunner.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import {
  PREFLIGHT_MESSAGE,
  preflightChecklist,
  preflightGate,
  preflightReady,
} from "../../lib/audio-preflight.js";
import {
  RECORDER_MESSAGE,
  isBlocked,
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
  const canAuthor = checkEntitlement(
    context.entitlements,
    CollegeFeature.COMMUNICATION,
    "speaking",
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Speaking</h1>
          <p className="text-sm text-ink-muted">
            Listening &amp; speaking practice. We score word accuracy, listening,
            fluency and (approximately) grammar &amp; relevance — accent and
            clarity are not scored.
          </p>
        </div>
        {canAuthor && phase === "list" ? (
          <Button asChild variant="secondary" size="sm">
            <Link to={`/c/${slug}/speaking/manage`}>
              <Settings2 className="mr-2 h-4 w-4" />
              Manage
            </Link>
          </Button>
        ) : null}
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
        <SpeakingRunner
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

// --- Mic pre-flight (unchanged from Step 10) --------------------------------

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
    // The PEAK over the whole take (held after recording stops) — NOT the live
    // `level`, which falls to ~0 once the meter stops, making "sound detected"
    // impossible to satisfy after the clip finished.
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

export default CollegeSpeakingPage;
