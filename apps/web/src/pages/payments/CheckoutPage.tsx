/**
 * Checkout (route: /checkout/:slug). Order summary + coupon preview via
 * POST /payments/quote, then "Pay" → POST /payments/orders → redirect to the
 * gateway (or mock) hosted page. A dedicated route (not a modal): it's a
 * focused flow, its own lazy chunk, and it pairs naturally with the separate
 * /payments/return route. The client never sends an amount; the server
 * re-prices and decides coupon validity — we only PREVIEW and gate "Pay".
 */
import {
  PaymentErrorCode,
  formatINR,
  type QuoteResponse,
  type SubjectDetail,
} from "@codeapt/shared";
import { ArrowLeft, CheckCircle2, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Spinner } from "../../components/ui/spinner.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { couponRejectCopy, shouldEnablePay } from "../../lib/payments-ui.js";
import { useQuery } from "../../lib/use-query.js";

type CouponState = "none" | "applied" | "rejected";

export function CheckoutPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const subjectQuery = useQuery<SubjectDetail>(
    () => api.curriculum.subject(slug),
    [slug],
  );
  const subject = subjectQuery.data;

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponState, setCouponState] = useState<CouponState>("none");
  const [quoting, setQuoting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Initial (no-coupon) quote for the canonical numbers + enrolled/free flags.
  useEffect(() => {
    if (!subject) return;
    let active = true;
    void api.payments
      .quote({ subjectId: subject.id })
      .then((q) => {
        if (active) setQuote(q);
      })
      .catch(() => {
        /* fall back to catalog numbers below */
      });
    return () => {
      active = false;
    };
  }, [subject]);

  const applyCoupon = async (): Promise<void> => {
    if (!subject || !couponInput.trim()) return;
    setQuoting(true);
    setPayError(null);
    try {
      const q = await api.payments.quote({
        subjectId: subject.id,
        couponCode: couponInput.trim(),
      });
      setQuote(q);
      setCouponState(q.couponApplied ? "applied" : "rejected");
    } catch (err) {
      setPayError(parseApiError(err).message);
    } finally {
      setQuoting(false);
    }
  };

  const removeCoupon = async (): Promise<void> => {
    setCouponInput("");
    setCouponState("none");
    if (!subject) return;
    setQuoting(true);
    try {
      setQuote(await api.payments.quote({ subjectId: subject.id }));
    } catch {
      /* ignore */
    } finally {
      setQuoting(false);
    }
  };

  const pay = async (): Promise<void> => {
    if (!subject) return;
    setPaying(true);
    setPayError(null);
    try {
      const res = await api.payments.createOrder({
        subjectId: subject.id,
        couponCode: couponState === "applied" ? couponInput.trim() : undefined,
      });
      // Hand off to the gateway/mock hosted page (full URL, same-origin in mock).
      window.location.assign(res.redirectUrl);
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.code === PaymentErrorCode.COUPON_REJECTED) {
        setCouponState("rejected");
        setPayError("That coupon can no longer be applied — please remove it.");
      } else if (parsed.code === PaymentErrorCode.ALREADY_ENROLLED) {
        navigate(`/courses/${slug}`);
      } else {
        setPayError(parsed.message);
      }
      setPaying(false);
    }
  };

  if (subjectQuery.loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (subjectQuery.error || !subject) {
    return (
      <Alert variant="error">
        {subjectQuery.error ?? "This course could not be loaded."}
      </Alert>
    );
  }

  const base = quote?.basePricePaise ?? subject.effectivePrice;
  const discount = quote?.discountPaise ?? 0;
  const final = quote?.finalPaise ?? subject.effectivePrice;
  const payEnabled =
    !paying &&
    shouldEnablePay({ couponEntered: couponState !== "none", quote });

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        to={`/courses/${slug}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to course
      </Link>

      <PageHeader title="Checkout" description={subject.name} />

      {quote?.alreadyEnrolled ? (
        <Alert variant="info" title="You already own this course">
          <Button asChild size="sm" className="mt-2">
            <Link to={`/learn/${slug}`}>Go to course</Link>
          </Button>
        </Alert>
      ) : (
        <Card>
          <CardContent className="space-y-5 p-6">
            {/* Coupon */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">
                Have a coupon?
              </label>
              {couponState === "applied" ? (
                <div className="flex items-center justify-between rounded-lg border border-success/40 bg-success-subtle/40 px-3 py-2">
                  <span className="inline-flex items-center gap-2 text-sm text-success-fg">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="font-mono font-semibold">
                      {quote?.couponCode ?? couponInput.trim().toUpperCase()}
                    </span>
                    applied
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeCoupon()}
                    className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={couponInput}
                    onChange={(e) => {
                      setCouponInput(e.target.value);
                      if (couponState === "rejected") setCouponState("none");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void applyCoupon();
                    }}
                    placeholder="Coupon code"
                    className="uppercase"
                    aria-label="Coupon code"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => void applyCoupon()}
                    loading={quoting}
                    disabled={!couponInput.trim()}
                  >
                    <Tag className="h-4 w-4" /> Apply
                  </Button>
                </div>
              )}
              {couponState === "rejected" && quote?.reason ? (
                <p className="text-sm text-error-fg">
                  {couponRejectCopy(quote.reason)}
                </p>
              ) : null}
            </div>

            {/* Summary */}
            <div className="space-y-2 border-t border-subtle pt-4 text-sm">
              <Row label="Price" value={formatINR(base)} />
              {discount > 0 ? (
                <Row
                  label={`Discount${quote?.couponCode ? ` (${quote.couponCode})` : ""}`}
                  value={`−${formatINR(discount)}`}
                  accent="success"
                />
              ) : null}
              <div className="flex items-center justify-between border-t border-subtle pt-3 text-base">
                <span className="font-semibold text-ink">Total</span>
                <span className="font-mono text-lg font-bold text-ink">
                  {formatINR(final)}
                </span>
              </div>
            </div>

            {payError ? <Alert variant="error">{payError}</Alert> : null}

            <Button
              className="w-full"
              size="lg"
              onClick={() => void pay()}
              loading={paying}
              disabled={!payEnabled}
            >
              Pay {formatINR(final)}
            </Button>
            <p className="text-center text-xs text-ink-muted">
              You’ll be redirected to complete payment securely.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "success";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-secondary">{label}</span>
      <span
        className={
          accent === "success"
            ? "font-mono text-success-fg"
            : "font-mono text-ink"
        }
      >
        {value}
      </span>
    </div>
  );
}
