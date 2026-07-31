/**
 * Drives one code run: submit → track status → expose result.
 *
 * Tracking prefers SSE (server pushes status transitions) and falls back to
 * polling if the stream errors before a terminal state. Either way the UI sees
 * the same queued → processing → completed/failed progression. All timers and
 * the EventSource are cleaned up on unmount or when a new run starts.
 */
import type {
  ExecuteRequest,
  ExecuteStatusResponse,
  ExecutionResult,
} from "@codeapt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, parseApiError } from "./api-client.js";

export type RunPhase =
  "idle" | "submitting" | "queued" | "processing" | "completed" | "failed";

export interface CodeRunnerState {
  phase: RunPhase;
  result: ExecutionResult | null;
  error: string | null;
  /** HTTP status of a failed SUBMIT (e.g. 429), so callers can special-case it. */
  errorStatus: number | null;
  jobId: string | null;
  /** Round-trip time from submit to a terminal state (client-measured). */
  elapsedMs: number | null;
}

const POLL_MS = 900;
const isTerminal = (s: string): boolean => s === "completed" || s === "failed";

export function useCodeRunner(): CodeRunnerState & {
  run: (req: ExecuteRequest) => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<CodeRunnerState>({
    phase: "idle",
    result: null,
    error: null,
    errorStatus: null,
    jobId: null,
    elapsedMs: null,
  });

  const startRef = useRef<number>(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const track = useCallback((jobId: string) => {
    let stopped = false;
    let es: EventSource | null = null;
    let pollTimer: number | null = null;

    const cleanup = (): void => {
      stopped = true;
      es?.close();
      es = null;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    cleanupRef.current = cleanup;

    const onSnapshot = (snap: ExecuteStatusResponse): void => {
      if (stopped) return;
      if (isTerminal(snap.status)) {
        setState({
          phase: snap.status === "completed" ? "completed" : "failed",
          result: snap.result,
          error: snap.error,
          errorStatus: null,
          jobId,
          elapsedMs: Date.now() - startRef.current,
        });
        cleanup();
        return;
      }
      setState((prev) => ({ ...prev, phase: snap.status as RunPhase }));
    };

    const startPolling = (): void => {
      if (stopped || pollTimer !== null) return;
      pollTimer = window.setInterval(() => {
        void api.execute
          .status(jobId)
          .then(onSnapshot)
          .catch(() => {
            /* transient — keep polling until terminal or unmount */
          });
      }, POLL_MS);
    };

    // Prefer SSE; fall back to polling on any stream error.
    try {
      es = new EventSource(api.execute.streamUrl(jobId), {
        withCredentials: true,
      });
      es.addEventListener("status", (ev) => {
        try {
          onSnapshot(JSON.parse((ev as MessageEvent<string>).data));
        } catch {
          /* ignore malformed frame */
        }
      });
      es.onerror = () => {
        if (stopped) return;
        es?.close();
        es = null;
        startPolling();
      };
    } catch {
      startPolling();
    }
  }, []);

  const run = useCallback(
    async (req: ExecuteRequest) => {
      stop();
      startRef.current = Date.now();
      setState({
        phase: "submitting",
        result: null,
        error: null,
        errorStatus: null,
        jobId: null,
        elapsedMs: null,
      });
      try {
        const ref = await api.execute.submit(req);
        setState({
          phase: "queued",
          result: null,
          error: null,
          errorStatus: null,
          jobId: ref.jobId,
          elapsedMs: null,
        });
        track(ref.jobId);
      } catch (err) {
        const parsed = parseApiError(err);
        setState({
          phase: "failed",
          result: null,
          error: parsed.message,
          errorStatus: parsed.status ?? null,
          jobId: null,
          elapsedMs: null,
        });
      }
    },
    [stop, track],
  );

  const reset = useCallback(() => {
    stop();
    setState({
      phase: "idle",
      result: null,
      error: null,
      errorStatus: null,
      jobId: null,
      elapsedMs: null,
    });
  }, [stop]);

  return { ...state, run, reset };
}
