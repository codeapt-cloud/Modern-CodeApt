/**
 * B2C / global speaking RUNNER (S30) — the slug-free counterpart of the college
 * speaking page's run flow, for a course-attached assessment reached from the
 * learn-player launcher or a composite. One assessment per page (`/speaking/:id`);
 * resume-or-start, a mic pre-flight, the SAME runner shell + results behind the
 * global engine adapter. A validated `?from=` returns the student to wherever
 * they launched from (the composite or the course), mirroring Step 25.
 */
import type { StartSpeakingResponse } from "@codeapt/shared";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { MicPreflight } from "../../components/speaking/MicPreflight.js";
import { SpeakingResults } from "../../components/speaking/SpeakingResults.js";
import { SpeakingRunner } from "../../components/speaking/SpeakingRunner.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { safeReturnPath } from "../../lib/return-to.js";
import { globalSpeakingEngine } from "../../lib/speaking-engine.js";

type Phase = "loading" | "preflight" | "run" | "done";

export function SpeakingRunnerPage(): JSX.Element {
  const { assessmentId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = safeReturnPath(searchParams.get("from"));
  const engine = globalSpeakingEngine();

  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState<StartSpeakingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // Resume an in-progress attempt if one exists (Step 22), else start fresh —
  // then land on the mic pre-flight. Runs once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const existing = await api.speaking.currentAttempt(assessmentId);
        const res = existing.attempt ?? (await api.speaking.start(assessmentId));
        setAttempt(res);
        setPhase("preflight");
      } catch (err) {
        setError(parseApiError(err).message);
      }
    })();
  }, [assessmentId]);

  const BackLink = (): JSX.Element | null =>
    returnTo ? (
      <Button asChild variant="ghost" size="sm">
        <Link to={returnTo}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Link>
      </Button>
    ) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Speaking</h1>
        <BackLink />
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      {phase === "loading" && !error ? <Skeleton className="h-40 w-full" /> : null}

      {phase === "preflight" && attempt ? (
        <MicPreflight onReady={() => setPhase("run")} windowSeconds={10} />
      ) : null}

      {phase === "run" && attempt ? (
        <SpeakingRunner
          engine={engine}
          attempt={attempt}
          onFinished={() => setPhase("done")}
        />
      ) : null}

      {phase === "done" && attempt ? (
        <>
          <SpeakingResults engine={engine} attemptId={attempt.attemptId} />
          {returnTo ? (
            <div className="flex justify-center">
              <Button onClick={() => navigate(returnTo)}>Back</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default SpeakingRunnerPage;
