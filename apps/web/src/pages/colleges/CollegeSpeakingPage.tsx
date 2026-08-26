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
import { ArrowLeft, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { MicPreflight } from "../../components/speaking/MicPreflight.js";
import { SpeakingResults } from "../../components/speaking/SpeakingResults.js";
import { SpeakingRunner } from "../../components/speaking/SpeakingRunner.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api, parseApiError } from "../../lib/api-client.js";
import {
  SUPPORTED_BROWSERS_MESSAGE,
  speechRecognitionSupported,
} from "../../lib/browser-stt.js";
import { safeReturnPath } from "../../lib/return-to.js";
import { collegeSpeakingEngine } from "../../lib/speaking-engine.js";
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Composite deep link (C5): `?assessment=<id>` auto-selects the paper, and a
  // validated `?from=` returns the student to the composite (C3). Absent → the
  // page behaves exactly as before (list-and-pick, no back-link).
  const deepLinkId = searchParams.get("assessment");
  const returnTo = safeReturnPath(searchParams.get("from"));
  const [autoError, setAutoError] = useState<string | null>(null);
  const autoStarted = useRef(false);
  const engine = collegeSpeakingEngine(slug);

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

  // Deep-link auto-select: RESUME an in-progress attempt if one exists (Step 22
  // resume, via the read-only currentAttempt lookup — no second attempt), else
  // start a fresh one; either way land on the mic pre-flight. Runs once.
  useEffect(() => {
    if (!entitled || !deepLinkId || autoStarted.current) return;
    autoStarted.current = true;
    void (async () => {
      try {
        const existing = await api.collegeSpeaking.currentAttempt(
          slug,
          deepLinkId,
        );
        const res =
          existing.attempt ??
          (await api.collegeSpeaking.start(slug, deepLinkId));
        setAttempt(res);
        setPhase("preflight");
      } catch (err) {
        // e.g. cap reached with no resumable attempt — show it on the list.
        setAutoError(parseApiError(err).message);
      }
    })();
  }, [entitled, deepLinkId, slug]);

  const BackToAssessment = (): JSX.Element | null =>
    returnTo ? (
      <Button asChild variant="ghost" size="sm">
        <Link to={returnTo}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to your assessment
        </Link>
      </Button>
    ) : null;

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
        <div className="flex items-center gap-2">
          <BackToAssessment />
          {canAuthor && phase === "list" ? (
            <Button asChild variant="secondary" size="sm">
              <Link to={`/c/${slug}/speaking/manage`}>
                <Settings2 className="mr-2 h-4 w-4" />
                Manage
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {autoError ? <Alert variant="error">{autoError}</Alert> : null}

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
                    {/* Step 32 compat gate: a browser-engine assessment needs Web
                        Speech (Chrome/Edge/Safari) — block the start on Firefox. */}
                    {a.speechEngine === "browser" &&
                    !speechRecognitionSupported(window as never) ? (
                      <span
                        className="max-w-xs text-right text-xs text-error-fg"
                        title={SUPPORTED_BROWSERS_MESSAGE}
                      >
                        Unsupported browser — use Chrome, Edge, or Safari
                      </span>
                    ) : (
                      <Button
                        disabled={a.maxAttempts > 0 && a.attemptsUsed >= a.maxAttempts}
                        onClick={() => void startAttempt(a.id)}
                      >
                        Start
                      </Button>
                    )}
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
          engine={engine}
          attempt={attempt}
          onFinished={() => setPhase("done")}
        />
      )}

      {phase === "done" && attempt && (
        <>
          <SpeakingResults engine={engine} attemptId={attempt.attemptId} />
          {returnTo ? (
            <div className="flex justify-center">
              <Button onClick={() => navigate(returnTo)}>
                Back to your assessment
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default CollegeSpeakingPage;
