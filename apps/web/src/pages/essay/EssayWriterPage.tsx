/**
 * The essay-writing screen (its own lazy chunk). Loads the prompt, drives the
 * compose → submit → poll → results flow via `useEssayGrading`, shows the
 * submission history, and posts optional (non-grading) analytics on submit.
 */
import type { EssayAnalyticsInput, EssayIntegrity } from "@codeapt/shared";
import { useReducedMotion, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { EssayComposer } from "../../components/essay/EssayComposer.js";
import { EssayHistory } from "../../components/essay/EssayHistory.js";
import { EssayResult } from "../../components/essay/EssayResult.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Spinner } from "../../components/ui/spinner.js";
import { api } from "../../lib/api-client.js";
import { essayAttemptStatus } from "../../lib/essay-compose.js";
import { collegeEssayWriterApi } from "../../lib/essay-writer-api.js";
import { safeReturnPath } from "../../lib/return-to.js";
import { useEssayGrading } from "../../lib/use-essay-grading.js";
import { useQuery } from "../../lib/use-query.js";

function GradingState({ reduced }: { reduced: boolean }) {
  return (
    <div className="flex min-h-[46vh] flex-col items-center justify-center gap-4 text-center">
      <motion.span
        className="font-mono text-5xl text-primary"
        animate={reduced ? undefined : { opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      >
        {"{ }"}
      </motion.span>
      <p className="text-ink">Grading your essay…</p>
      <p className="text-sm text-ink-muted">
        Scoring seven dimensions — this only takes a moment.
      </p>
    </div>
  );
}

export function EssayWriterPage() {
  const { id = "" } = useParams();
  const reduced = useReducedMotion() ?? false;
  // A COLLEGE essay carries `?c=<slug>`: list/detail/draft/submit are tenant-
  // scoped via the injected writerApi, but the grading POLL + analytics fall
  // through to the SHARED ownership-authorized endpoints — so the writer + its
  // hooks are reused unchanged. No `?c` → the individual flow, byte-for-byte.
  const [searchParams] = useSearchParams();
  const collegeSlug = searchParams.get("c");
  // Back-nav returns to the college student space when launched from there.
  const essaysHome = collegeSlug
    ? `/c/${encodeURIComponent(collegeSlug)}/essays`
    : "/essays";
  // A composite launch passes a validated in-app `?from=` return target (C3);
  // absent/invalid → the normal essays home, so a direct visit is unchanged.
  const returnTo = safeReturnPath(searchParams.get("from")) ?? essaysHome;
  const fromComposite = returnTo !== essaysHome;
  const backLabel = fromComposite ? "Back to your assessment" : "All essays";
  const writerApi = useMemo(
    () => (collegeSlug ? collegeEssayWriterApi(collegeSlug) : api.essays),
    [collegeSlug],
  );

  const prompt = useQuery(() => writerApi.get(id), [id, writerApi]);
  const history = useQuery(() => writerApi.submissions(id), [id, writerApi]);
  const grading = useEssayGrading(id, writerApi);

  const refreshHistory = history.refetch;
  const refreshPrompt = prompt.refetch;

  // Refresh history AND the prompt the moment a grade lands, so the new attempt
  // appears below the results and the attempt counter/cap stays accurate.
  const phase = grading.phase;
  useEffect(() => {
    if (phase === "done") {
      refreshHistory();
      refreshPrompt();
    }
  }, [phase, refreshHistory, refreshPrompt]);

  const attempts = prompt.data
    ? essayAttemptStatus(prompt.data.attemptsUsed, prompt.data.maxAttempts)
    : null;

  const handleSubmit = async (
    content: string,
    analytics: EssayAnalyticsInput,
    integrity?: EssayIntegrity,
  ): Promise<void> => {
    const jobId = await grading.submit(content, integrity);
    if (jobId) {
      // Fire-and-forget: analytics are additive and never affect the grade.
      grading.sendAnalytics(jobId, analytics);
    }
  };

  const handleWriteAnother = (): void => {
    grading.reset();
    refreshHistory();
    refreshPrompt();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Write essay"
        breadcrumbs={[
          { label: fromComposite ? "Assessment" : "Essays", href: returnTo },
          { label: prompt.data?.title ?? "Prompt" },
        ]}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to={returnTo}>
              <ArrowLeft className="h-4 w-4" /> {backLabel}
            </Link>
          </Button>
        }
      />

      {prompt.loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : prompt.error || !prompt.data ? (
        <Alert variant="error">
          {prompt.error ?? "This essay isn’t available to you."}
        </Alert>
      ) : (
        <>
          {grading.phase === "compose" ? (
            attempts?.atLimit ? (
              <Alert variant="warning">
                Attempt limit reached — you’ve used all {attempts.max} attempts
                for this prompt. Your submissions are listed below.
              </Alert>
            ) : (
              <EssayComposer
                prompt={prompt.data}
                submitting={false}
                submitError={grading.submitError}
                attemptLabel={
                  attempts
                    ? `Attempt ${attempts.used + 1} of ${attempts.max}`
                    : null
                }
                // College essays (?c=slug) are proctored like exams; individual
                // essays are not — their flow is unchanged.
                proctored={Boolean(collegeSlug)}
                onSubmit={(c, a, i) => void handleSubmit(c, a, i)}
                writerApi={writerApi}
              />
            )
          ) : null}

          {grading.phase === "submitting" || grading.phase === "grading" ? (
            <GradingState reduced={reduced} />
          ) : null}

          {grading.phase === "done" && grading.result ? (
            <EssayResult
              result={grading.result}
              reduced={reduced}
              onWriteAnother={handleWriteAnother}
              aiFeedbackLoader={() =>
                api.essays.aiFeedback(grading.result!.jobId)
              }
            />
          ) : null}

          {grading.phase === "error" ? (
            <div className="space-y-4">
              <Alert variant="error">
                {grading.error ?? "Grading failed. Please try again."}
              </Alert>
              <Button onClick={handleWriteAnother}>Try again</Button>
            </div>
          ) : null}

          {/* Submission history — always visible below the active view. */}
          <section className="space-y-3 rounded-2xl border border-subtle bg-surface-raised p-5">
            <h3 className="text-sm font-semibold text-ink">Your submissions</h3>
            {history.loading ? (
              <Spinner size="sm" />
            ) : (
              <EssayHistory
                items={history.data?.items ?? []}
                onOpen={(jobId) => grading.showAttempt(jobId)}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
