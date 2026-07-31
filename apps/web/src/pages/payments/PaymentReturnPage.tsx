/**
 * Payment return (route: /payments/return?orderId=...&mock=1). Target of
 * PAYMENT_REDIRECT_URL.
 *
 *  - mock=1: shows a clearly-labeled DEV interstitial ("Test payment (mock
 *    gateway)") with Simulate success/failure → POST /payments/mock/pay (drives
 *    the signed webhook), then proceeds to the poll. Real PhonePe replaces this
 *    with its hosted page via an env flip — no code change.
 *  - then polls GET /payments/orders/:orderId until terminal (relying on the
 *    WEBHOOK-driven transition; mock reconcile-on-read stays pending), with an
 *    attempt cap → a graceful "still processing" fallback.
 */
import { PaymentStatus } from "@codeapt/shared";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, FlaskConical, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Reveal } from "../../components/motion/index.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { springSoft } from "../../lib/motion.js";
import { useOrderPoll } from "../../lib/use-order-poll.js";

export function PaymentReturnPage() {
  const [params] = useSearchParams();
  const orderId = params.get("orderId");
  const isMock = params.get("mock") === "1";

  const [phase, setPhase] = useState<"interstitial" | "poll">(
    isMock ? "interstitial" : "poll",
  );

  if (!orderId) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Alert variant="error">Missing order reference.</Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-10">
      {phase === "interstitial" ? (
        <MockInterstitial orderId={orderId} onDone={() => setPhase("poll")} />
      ) : (
        <PollView orderId={orderId} />
      )}
    </div>
  );
}

/** Dev-only mock payment simulator (only reachable via ?mock=1). */
function MockInterstitial({
  orderId,
  onDone,
}: {
  orderId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<"success" | "failure" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const simulate = async (outcome: "success" | "failure"): Promise<void> => {
    setBusy(outcome);
    setError(null);
    try {
      await api.payments.mockPay({ orderId, outcome });
      onDone();
    } catch (err) {
      setError(parseApiError(err).message);
      setBusy(null);
    }
  };

  return (
    <Card className="border-warning/50">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2 text-warning-fg">
          <FlaskConical className="h-5 w-5" />
          <h2 className="font-semibold">Test payment (mock gateway)</h2>
        </div>
        <p className="text-sm text-ink-secondary">
          This is a development simulation — no real gateway, no real charge.
          Choose an outcome to drive the payment webhook.
        </p>
        {error ? <Alert variant="error">{error}</Alert> : null}
        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={() => void simulate("success")}
            loading={busy === "success"}
            disabled={busy !== null}
          >
            Simulate success
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => void simulate("failure")}
            loading={busy === "failure"}
            disabled={busy !== null}
          >
            Simulate failure
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PollView({ orderId }: { orderId: string }) {
  const reduced = useReducedMotion();
  const { order, phase, error } = useOrderPoll(orderId);

  if (phase === "error") {
    return <Alert variant="error">{error ?? "Something went wrong."}</Alert>;
  }

  if (phase === "timeout") {
    return (
      <Card>
        <CardContent className="space-y-4 p-8 text-center">
          <p className="font-mono text-3xl text-primary">{"{ }"}</p>
          <h2 className="text-lg font-semibold text-ink">
            Still processing your payment
          </h2>
          <p className="text-sm text-ink-muted">
            This is taking longer than usual. You can check the status in your
            orders.
          </p>
          <Button asChild>
            <Link to="/orders">View my orders</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === "polling" || !order) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
        <motion.span
          className="font-mono text-5xl text-primary"
          animate={reduced ? undefined : { opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        >
          {"{ }"}
        </motion.span>
        <p className="text-ink">Confirming your payment…</p>
      </div>
    );
  }

  // Terminal.
  if (order.status === PaymentStatus.SUCCESS) {
    return (
      <Card className="border-success/50">
        <CardContent className="space-y-4 p-8 text-center">
          {/* One-shot checkmark settle — calm, not celebratory. */}
          <motion.div
            className="mx-auto w-fit"
            initial={reduced ? false : { scale: 0.6, opacity: 0 }}
            animate={reduced ? undefined : { scale: 1, opacity: 1 }}
            transition={springSoft}
          >
            <CheckCircle2 className="h-12 w-12 text-success-fg" />
          </motion.div>
          {/* The CTA lives inside the reveal but stays clickable throughout —
              a fade never blocks pointer events, so the action is never gated. */}
          <Reveal variant="fadeInUp" delay={0.08} className="space-y-4">
            <h2 className="text-xl font-bold text-ink">Payment successful</h2>
            <p className="text-sm text-ink-muted">
              You’re enrolled in{" "}
              <span className="font-medium text-ink">
                {order.subject.name}
              </span>
              .
            </p>
            {order.enrolled ? (
              <Button asChild size="lg">
                <Link to={`/learn/${order.subject.slug}`}>Go to course</Link>
              </Button>
            ) : (
              <p className="text-xs text-ink-muted">Finalizing your access…</p>
            )}
          </Reveal>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-error/50">
      <CardContent className="space-y-4 p-8 text-center">
        <XCircle className="mx-auto h-12 w-12 text-error-fg" />
        <h2 className="text-xl font-bold text-ink">Payment {order.status}</h2>
        <p className="text-sm text-ink-muted">
          Your payment didn’t go through and you haven’t been charged.
        </p>
        <Button asChild>
          <Link to={`/checkout/${order.subject.slug}`}>Try again</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
