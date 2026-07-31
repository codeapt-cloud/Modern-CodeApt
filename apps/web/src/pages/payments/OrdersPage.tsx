/**
 * My orders (route: /orders). The buyer's payment history, newest first. A
 * successful order links to the course; a failed/pending one links back to
 * checkout to retry.
 */
import { PaymentStatus, formatINR, type OrderSummary } from "@codeapt/shared";
import { Receipt } from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";

const STATUS_VARIANT: Record<
  PaymentStatus,
  "neutral" | "info" | "success" | "error"
> = {
  created: "neutral",
  pending: "info",
  success: "success",
  failed: "error",
  expired: "error",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function OrderRow({ order }: { order: OrderSummary }) {
  const succeeded = order.status === PaymentStatus.SUCCESS;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink">
              {order.subjectName}
            </span>
            <Badge variant={STATUS_VARIANT[order.status]}>{order.status}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            {fmtDate(order.createdAt)}
            {order.couponCode ? (
              <>
                {" · "}
                <span className="font-mono">{order.couponCode}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm font-semibold text-ink">
            {formatINR(order.amountPaise)}
          </span>
          {succeeded ? (
            <Button asChild size="sm" variant="secondary">
              <Link to={`/learn/${order.subjectSlug}`}>Go to course</Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="ghost">
              <Link to={`/checkout/${order.subjectSlug}`}>Retry</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function OrdersPage() {
  const { data, loading, error } = useQuery(() => api.payments.orders(), []);
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My orders"
        description="Your course purchases and their payment status."
      />
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description="When you buy a paid course, your orders will appear here."
          icon={<Receipt />}
        />
      ) : (
        <div className="space-y-3">
          {items.map((o) => (
            <OrderRow key={o.orderId} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}
