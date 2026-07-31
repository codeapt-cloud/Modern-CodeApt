/**
 * Essay grading orchestrator hook. Mirrors the exam runner's poll pattern:
 *   submit → POST /essays/:id/submit (202 JobRef, or a 422 length error) →
 *   poll GET /essays/submissions/:jobId (~1s) until gradingPending is false →
 *   render the result (or a graceful failed state).
 *
 * A single timer drives the poll; it is cleared on terminal state and on
 * unmount. `submitError` carries a client-surfaced 422 (LENGTH_OUT_OF_RANGE)
 * without leaving the compose screen; `error` carries grading failures.
 */
import {
  EssayErrorCode,
  EssayGradingStatus,
  type EssayAnalyticsInput,
  type EssayGradingResult,
  type EssayIntegrity,
} from "@codeapt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, parseApiError } from "./api-client.js";
import type { EssayWriterApi } from "./essay-writer-api.js";

export type EssayPhase =
  "compose" | "submitting" | "grading" | "done" | "error";

const POLL_MS = 1000;

/**
 * `writerApi` sources submit + poll + analytics. Defaults to `api.essays` (the
 * individual flow, unchanged); the college writer injects a slug-bound adapter
 * whose poll/analytics fall through to the shared ownership-authorized endpoints.
 */
export function useEssayGrading(
  essayTopicId: string,
  writerApi: EssayWriterApi = api.essays,
) {
  const [phase, setPhase] = useState<EssayPhase>("compose");
  const [result, setResult] = useState<EssayGradingResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const pollTimer = useRef<number | null>(null);
  const cancelled = useRef(false);

  const stopPoll = useCallback(() => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      stopPoll();
    };
  }, [stopPoll]);

  const poll = useCallback(
    (id: string) => {
    const tick = async (): Promise<void> => {
      try {
        const res = await writerApi.submission(id);
        if (cancelled.current) return;
        if (res.status === EssayGradingStatus.FAILED) {
          setError(res.error ?? "Grading failed. Please try again.");
          setPhase("error");
          return;
        }
        if (res.gradingPending) {
          pollTimer.current = window.setTimeout(() => void tick(), POLL_MS);
          return;
        }
        setResult(res);
        setPhase("done");
      } catch (err) {
        if (cancelled.current) return;
        setError(parseApiError(err).message);
        setPhase("error");
      }
    };
    void tick();
    },
    [writerApi],
  );

  /**
   * Submit content for grading. Returns the new jobId on success, or null if a
   * client-surfaced 422 (or another error) fired. The jobId lets the caller
   * attach optional analytics to exactly this submission.
   */
  const submit = useCallback(
    async (
      content: string,
      integrity?: EssayIntegrity,
    ): Promise<string | null> => {
      setSubmitError(null);
      setError(null);
      setPhase("submitting");
      try {
        const ref = await writerApi.submit(essayTopicId, content, integrity);
        if (cancelled.current) return null;
        setJobId(ref.jobId);
        setPhase("grading");
        poll(ref.jobId);
        return ref.jobId;
      } catch (err) {
        if (cancelled.current) return null;
        const parsed = parseApiError(err);
        // Length + attempt-limit rejections are expected — surface inline and
        // stay on compose rather than showing a full error screen.
        if (
          parsed.code === EssayErrorCode.LENGTH_OUT_OF_RANGE ||
          parsed.code === EssayErrorCode.ATTEMPT_LIMIT_REACHED
        ) {
          setSubmitError(parsed.message);
          setPhase("compose");
          return null;
        }
        setError(parsed.message);
        setPhase("error");
        return null;
      }
    },
    [essayTopicId, poll, writerApi],
  );

  /** Re-open a past attempt's result by re-polling its jobId (history click). */
  const showAttempt = useCallback(
    (id: string) => {
      stopPoll();
      setJobId(id);
      setResult(null);
      setError(null);
      setPhase("grading");
      poll(id);
    },
    [poll, stopPoll],
  );

  /** Return to a blank compose screen ("write another"). */
  const reset = useCallback(() => {
    stopPoll();
    setResult(null);
    setJobId(null);
    setError(null);
    setSubmitError(null);
    setPhase("compose");
  }, [stopPoll]);

  /** Best-effort, fire-and-forget analytics post (never blocks / throws). */
  const sendAnalytics = useCallback(
    (id: string, body: EssayAnalyticsInput) => {
      void writerApi.analytics(id, body).catch(() => {
        /* additive + optional — a failure never affects the grade or the UX */
      });
    },
    [writerApi],
  );

  return {
    phase,
    result,
    jobId,
    error,
    submitError,
    submit,
    showAttempt,
    reset,
    sendAnalytics,
  };
}
