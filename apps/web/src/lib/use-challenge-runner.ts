/**
 * Drives a CODE daily-challenge submission end-to-end:
 *   submit-code → track the ExecutionJob (SSE, polling fallback) →
 *   on completion, finalize (award + streak).
 *
 * Reuses the Step-6 execution status endpoint (GET /api/execute/:jobId) for
 * queued→processing→completed, then calls the challenge finalize endpoint,
 * which is idempotent. Timers/EventSource are cleaned up on unmount / re-run.
 */
import type {
  ExecuteStatusResponse,
  FinalizeChallengeResponse,
  SubmitCodeRequest,
} from "@codeapt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, parseApiError } from "./api-client.js";

export type ChallengePhase =
  | "idle"
  | "submitting"
  | "queued"
  | "processing"
  | "finalizing"
  | "done"
  | "error";

export interface ChallengeRunState {
  phase: ChallengePhase;
  finalize: FinalizeChallengeResponse | null;
  error: string | null;
  jobId: string | null;
}

const POLL_MS = 900;
const isTerminal = (s: string): boolean => s === "completed" || s === "failed";

export function useChallengeRunner(): ChallengeRunState & {
  run: (req: SubmitCodeRequest) => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<ChallengeRunState>({
    phase: "idle",
    finalize: null,
    error: null,
    jobId: null,
  });

  const cleanupRef = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const finalize = useCallback(async (jobId: string) => {
    setState((prev) => ({ ...prev, phase: "finalizing" }));
    try {
      const result = await api.challenges.finalize(jobId);
      setState({ phase: "done", finalize: result, error: null, jobId });
    } catch (err) {
      setState({
        phase: "error",
        finalize: null,
        error: parseApiError(err).message,
        jobId,
      });
    }
  }, []);

  const track = useCallback(
    (jobId: string) => {
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
          cleanup();
          if (snap.status === "failed") {
            setState({
              phase: "error",
              finalize: null,
              error: snap.error ?? "Execution failed.",
              jobId,
            });
          } else {
            void finalize(jobId);
          }
          return;
        }
        setState((prev) => ({ ...prev, phase: snap.status as ChallengePhase }));
      };

      const startPolling = (): void => {
        if (stopped || pollTimer !== null) return;
        pollTimer = window.setInterval(() => {
          void api.execute
            .status(jobId)
            .then(onSnapshot)
            .catch(() => {
              /* transient — keep polling */
            });
        }, POLL_MS);
      };

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
    },
    [finalize],
  );

  const run = useCallback(
    async (req: SubmitCodeRequest) => {
      stop();
      setState({
        phase: "submitting",
        finalize: null,
        error: null,
        jobId: null,
      });
      try {
        const ref = await api.challenges.submitCode(req);
        setState({
          phase: "queued",
          finalize: null,
          error: null,
          jobId: ref.jobId,
        });
        track(ref.jobId);
      } catch (err) {
        setState({
          phase: "error",
          finalize: null,
          error: parseApiError(err).message,
          jobId: null,
        });
      }
    },
    [stop, track],
  );

  const reset = useCallback(() => {
    stop();
    setState({ phase: "idle", finalize: null, error: null, jobId: null });
  }, [stop]);

  return { ...state, run, reset };
}
