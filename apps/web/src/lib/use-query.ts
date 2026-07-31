/**
 * Minimal async-query hook: runs `fn` on mount and when `deps` change, with
 * loading/error/data state and a `refetch`. (A full data-cache lib is overkill
 * for this step; this keeps pages simple and typed.)
 */
import { useCallback, useEffect, useState } from "react";

import { parseApiError } from "./api-client.js";

export interface QueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useQuery<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[],
): QueryResult<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // fn is intentionally not a dep — callers pass inline closures; `deps`
  // controls re-runs (same contract as useEffect deps).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    run()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(parseApiError(err).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [run, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, refetch };
}
