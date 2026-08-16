/**
 * Fullscreen exam runner (logged-in). Shows the ready/rules screen; "Begin"
 * requests browser fullscreen (must be a user gesture) THEN starts the attempt
 * — so the server-side section timer begins at Begin — and hands the started
 * attempt to <ExamRunner>. Rendered outside the AppShell.
 */
import type { StartAttemptResponse } from "@codeapt/shared";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ExamRunner } from "../../components/exam/ExamRunner.js";
import { ReadyScreen } from "../../components/exam/ReadyScreen.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Spinner } from "../../components/ui/spinner.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";

export function ExamRunnerPage() {
  const { examId = "" } = useParams();
  const navigate = useNavigate();
  // A COLLEGE exam carries `?c=<slug>`: the LIST + START are tenant-scoped, but
  // the started attempt hands off to the SAME <ExamRunner> + shared /attempts/*
  // engine (authorized by ownership). No `?c` → the individual flow, unchanged.
  const [searchParams] = useSearchParams();
  const collegeSlug = searchParams.get("c");
  // Return to the college student space when launched from there (the flow is
  // otherwise identical); individual runs go back to the learner exams list.
  const examsHome = collegeSlug
    ? `/c/${encodeURIComponent(collegeSlug)}/exams`
    : "/exams";

  const { data, loading } = useQuery(
    () =>
      collegeSlug ? api.collegeExams.studentList(collegeSlug) : api.exams.list(),
    [collegeSlug],
  );
  const exam = data?.items.find((e) => e.id === examId);

  const [started, setStarted] = useState<StartAttemptResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [accessCode, setAccessCode] = useState("");

  const needsCode = exam?.accessCodeEnabled ?? false;

  const begin = async (): Promise<void> => {
    if (needsCode && !accessCode.trim()) {
      setError("Enter the start code given by your invigilator.");
      return;
    }
    setStarting(true);
    setError("");
    // Request fullscreen from the user gesture (best-effort).
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* fullscreen may be denied; the exam still runs */
    }
    const code = accessCode.trim() || undefined;
    try {
      const res = collegeSlug
        ? await api.collegeExams.studentStart(collegeSlug, examId, code)
        : await api.exams.start(examId, code);
      setStarted(res);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setStarting(false);
    }
  };

  if (started) {
    return (
      <ExamRunner
        attemptId={started.attemptId}
        token={null}
        initial={started}
        onExit={() => navigate(examsHome)}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="font-mono text-2xl text-primary">{"{ }"}</p>
        <p className="text-ink">This exam isn’t available to you.</p>
        <Button onClick={() => navigate(examsHome)}>Back to exams</Button>
      </div>
    );
  }

  return (
    <ReadyScreen
      title={exam.title}
      meta={{
        sectionCount: exam.sectionCount,
        totalDurationMinutes: exam.totalDurationMinutes,
        totalMarks: exam.totalMarks,
        passPercentage: exam.passPercentage,
      }}
      action={
        <div className="flex w-full max-w-sm flex-col items-center gap-3">
          {needsCode ? (
            <Input
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              placeholder="Start code"
              aria-label="Start code"
              className="text-center"
              maxLength={64}
            />
          ) : null}
          {error ? <Alert variant="error">{error}</Alert> : null}
          <Button
            size="lg"
            onClick={() => void begin()}
            loading={starting}
            disabled={needsCode && !accessCode.trim()}
          >
            Begin exam
          </Button>
        </div>
      }
    />
  );
}
