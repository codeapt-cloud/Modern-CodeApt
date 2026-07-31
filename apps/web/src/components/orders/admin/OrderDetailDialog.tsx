/**
 * Read-only order detail (ledger read — CRUD batch 3a). Shows the order's
 * app-owned facts (student, subject, amount, coupon, timestamps) and a clearly
 * labelled "Payment gateway" block for the gateway-owned fields (transactionId +
 * gateway status). Nothing here is editable: the order lifecycle is owned by the
 * verified PhonePe callback/webhook, never the admin.
 */
import {
  PaymentStatus,
  formatINR,
  type AdminOrderDetail,
  type PaymentStatus as PaymentStatusT,
} from "@codeapt/shared";
import { Lock } from "lucide-react";

import { api } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { Skeleton } from "../../ui/skeleton.js";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export const STATUS_LABEL: Record<PaymentStatusT, string> = {
  [PaymentStatus.CREATED]: "Created",
  [PaymentStatus.PENDING]: "Pending",
  [PaymentStatus.SUCCESS]: "Success",
  [PaymentStatus.FAILED]: "Failed",
  [PaymentStatus.EXPIRED]: "Expired",
};

export function statusVariant(
  status: PaymentStatusT,
): "success" | "warning" | "error" | "neutral" {
  if (status === PaymentStatus.SUCCESS) return "success";
  if (status === PaymentStatus.FAILED || status === PaymentStatus.EXPIRED)
    return "error";
  if (status === PaymentStatus.PENDING) return "warning";
  return "neutral";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface-base p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="font-mono text-sm font-medium text-ink">{value}</p>
    </div>
  );
}

export interface OrderDetailDialogProps {
  orderId: string;
  onOpenChange: (open: boolean) => void;
}

export function OrderDetailDialog({
  orderId,
  onOpenChange,
}: OrderDetailDialogProps) {
  const { data, loading, error } = useQuery<AdminOrderDetail>(
    () => api.adminOrders.get(orderId),
    [orderId],
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data ? data.subject : "Order"}</DialogTitle>
          <DialogDescription>
            {data
              ? `${data.student}${data.studentEmail ? ` · ${data.studentEmail}` : ""}`
              : "Loading order…"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <Skeleton className="h-72 w-full rounded-2xl" />
        ) : error ? (
          <Alert variant="error">{error}</Alert>
        ) : data ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant={statusVariant(data.status)}>
                {STATUS_LABEL[data.status] ?? data.status}
              </Badge>
              <Badge variant="neutral">{formatINR(data.amount)}</Badge>
              {data.couponCode ? (
                <Badge variant="neutral">Coupon {data.couponCode}</Badge>
              ) : null}
            </div>

            {/* --- App-owned order facts --- */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">Order</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Field label="Order id" value={data.orderId} />
                <Field label="Amount (paid)" value={formatINR(data.amount)} />
                <Field
                  label="Discount"
                  value={formatINR(data.discountAmount)}
                />
                <Field label="Coupon" value={data.couponCode ?? "—"} />
                <Field label="Created" value={fmtDate(data.createdAt)} />
                <Field label="Updated" value={fmtDate(data.updatedAt)} />
              </div>
            </div>

            {/* --- Gateway-owned: read-only --- */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-ink-muted" />
                <h3 className="text-sm font-semibold text-ink">
                  Payment gateway
                </h3>
                <Badge variant="neutral">Read-only</Badge>
              </div>
              <p className="text-xs text-ink-muted">
                Set by the verified PhonePe callback / webhook — never edited
                from the admin.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field
                  label="Transaction id (gateway)"
                  value={data.gateway.transactionId ?? "— not settled —"}
                />
                <Field
                  label="Gateway status"
                  value={STATUS_LABEL[data.gateway.status] ?? data.gateway.status}
                />
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
