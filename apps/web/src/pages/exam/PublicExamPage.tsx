/**
 * Public (anonymous) exam entry — reachable only by its link token, no auth.
 * Checks availability, captures rollNumber + collegeName, starts the attempt,
 * keeps the returned attemptToken in memory, and runs the SAME <ExamRunner>
 * (all engine calls send X-Attempt-Token). Rendered outside the AppShell.
 */
import type { StartAttemptResponse } from "@codeapt/shared";
import { CalendarX2 } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { Logo } from "../../components/brand/Logo.js";
import { ExamRunner } from "../../components/exam/ExamRunner.js";
import { ReadyScreen } from "../../components/exam/ReadyScreen.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Spinner } from "../../components/ui/spinner.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";

export function PublicExamPage() {
  const { token = "" } = useParams();
  const { data, loading } = useQuery(
    () => api.exams.publicAvailability(token),
    [token],
  );

  const [started, setStarted] = useState<StartAttemptResponse | null>(null);
  const [rollNumber, setRollNumber] = useState("");
  const [collegeName, setCollegeName] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const begin = async (): Promise<void> => {
    if (!rollNumber.trim() || !collegeName.trim()) return;
    setStarting(true);
    setError("");
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* fullscreen optional */
    }
    try {
      const res = await api.exams.publicStart(token, {
        rollNumber: rollNumber.trim(),
        collegeName: collegeName.trim(),
      });
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
        token={started.attemptToken}
        initial={started}
        onExit={() => window.location.reload()}
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

  if (!data || !data.available || !data.exam) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
        <Logo className="mb-2 h-7" />
        <CalendarX2 className="h-10 w-10 text-ink-muted" />
        <h1 className="text-xl font-bold text-ink">Exam not available</h1>
        <p className="text-sm text-ink-muted">
          This exam link is inactive or outside its scheduled window. Please
          check with the organiser.
        </p>
      </div>
    );
  }

  return (
    <ReadyScreen
      title={data.exam.title}
      meta={{
        sectionCount: data.exam.sectionCount,
        totalDurationMinutes: data.exam.totalDurationMinutes,
        totalMarks: data.exam.totalMarks,
        passPercentage: data.exam.passPercentage,
      }}
      action={
        <form
          className="flex w-full max-w-sm flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void begin();
          }}
        >
          <Input
            placeholder="Roll number"
            value={rollNumber}
            onChange={(e) => setRollNumber(e.target.value)}
            required
            aria-label="Roll number"
          />
          <Input
            placeholder="College name"
            value={collegeName}
            onChange={(e) => setCollegeName(e.target.value)}
            required
            aria-label="College name"
          />
          {error ? <Alert variant="error">{error}</Alert> : null}
          <Button
            type="submit"
            size="lg"
            loading={starting}
            disabled={!rollNumber.trim() || !collegeName.trim()}
          >
            Begin exam
          </Button>
        </form>
      }
    />
  );
}
