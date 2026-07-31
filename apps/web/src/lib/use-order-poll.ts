/**
 * Poll an order's status after the buyer returns from checkout. A single timer
 * polls GET /payments/orders/:orderId (~1s) until the status is terminal
 * (success | failed | expired) or an attempt cap is reached; it's cleared on
 * terminal state and on unmount.
 *
 * NOTE (mock gateway): reconcile-on-read stays `pending` in mock mode, so this
 * poll relies on the WEBHOOK having advanced the order (driven by the mock-pay
 * interstitial). The cap yields a graceful "still processing" fallback rather
 * than spinning forever.
 */
import type { OrderStatusResponse } from "@codeapt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, parseApiError } from "./api-client.js";
import { isTerminalStatus } from "./payments-ui.js";

const POLL_MS = 1000;
const MAX_ATTEMPTS = 30; // ~30s, then fall back gracefully

export type OrderPollPhase = "polling" | "terminal" | "timeout" | "error";

export function useOrderPoll(orderId: string | null) {
  const [order, setOrder] = useState<OrderStatusResponse | null>(null);
  const [phase, setPhase] = useState<OrderPollPhase>("polling");
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<number | null>(null);
  const attempts = useRef(0);
  const cancelled = useRef(false);

  const stop = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    cancelled.current = false;
    attempts.current = 0;
    if (!orderId) {
      setPhase("error");
      setError("Missing order reference.");
      return;
    }
    setPhase("polling");
    setError(null);

    const tick = async (): Promise<void> => {
      try {
        const res = await api.payments.order(orderId);
        if (cancelled.current) return;
        setOrder(res);
        if (isTerminalStatus(res.status)) {
          setPhase("terminal");
          return;
        }
        attempts.current += 1;
        if (attempts.current >= MAX_ATTEMPTS) {
          setPhase("timeout");
          return;
        }
        timer.current = window.setTimeout(() => void tick(), POLL_MS);
      } catch (err) {
        if (cancelled.current) return;
        setError(parseApiError(err).message);
        setPhase("error");
      }
    };
    void tick();

    return () => {
      cancelled.current = true;
      stop();
    };
  }, [orderId, stop]);

  return { order, phase, error };
}
