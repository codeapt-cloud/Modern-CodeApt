/**
 * Coupon admin (route: /admin/coupons). Lists every coupon with its type+value,
 * scope, validity window, usage vs limit, and active state; create/edit via the
 * editor dialog; a one-click active toggle (the honest "retire" for a coupon
 * with redemption history); and delete via the shared ConfirmDeleteDialog, which
 * renders the DELETE_BLOCKED 409 (orders referencing it) with a deactivate hint.
 */
import {
  CouponDiscountType,
  formatINR,
  type AdminCoupon,
} from "@codeapt/shared";
import { Pencil, Plus, Ticket, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDeleteDialog } from "../../../components/curriculum/admin/ConfirmDeleteDialog.js";
import { CouponEditorDialog } from "../../../components/coupons/admin/CouponEditorDialog.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card } from "../../../components/ui/card.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { IconButton } from "../../../components/ui/icon-button.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { Switch } from "../../../components/ui/switch.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { useToast } from "../../../components/ui/toast.js";
import { api, parseApiError } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";

function discountLabel(c: AdminCoupon): string {
  return c.discountType === CouponDiscountType.FIXED
    ? `${formatINR(c.discountValue)} off`
    : `${c.discountValue}% off`;
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

export function AdminCouponsPage() {
  const { toast } = useToast();
  const { data, loading, error, refetch } = useQuery(
    () => api.adminCoupons.list(),
    [],
  );
  const items = data?.items ?? [];

  const [editing, setEditing] = useState<AdminCoupon | null | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<AdminCoupon | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggleActive = async (c: AdminCoupon): Promise<void> => {
    setBusyId(c.id);
    try {
      await api.adminCoupons.setActive(c.id, !c.active);
      refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coupons"
        description="Create and manage discount coupons redeemed at checkout."
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="h-4 w-4" /> New coupon
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No coupons yet"
          description="Create your first coupon — percentage or fixed, global or per-course."
          icon={<Ticket />}
          action={
            <Button size="sm" onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4" /> New coupon
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Validity</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <span className="font-mono font-medium text-ink">
                      {c.code}
                    </span>
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {discountLabel(c)}
                  </TableCell>
                  <TableCell>
                    {c.subjectName ? (
                      <Badge variant="info">{c.subjectName}</Badge>
                    ) : (
                      <Badge variant="neutral">Global</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-ink-muted">
                    {fmtDate(c.validFrom)} → {fmtDate(c.validTo)}
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {c.usedCount}
                    {c.usageLimit != null ? ` / ${c.usageLimit}` : ""}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={c.active}
                      disabled={busyId === c.id}
                      onCheckedChange={() => void toggleActive(c)}
                      aria-label={`Toggle ${c.code} active`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        aria-label="Edit coupon"
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => setEditing(c)}
                      />
                      <IconButton
                        aria-label="Delete coupon"
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                        onClick={() => setDeleting(c)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {editing !== undefined ? (
        <CouponEditorDialog
          key={editing?.id ?? "new"}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(undefined);
          }}
          initial={editing}
          onSaved={refetch}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this coupon?"
        noun="coupon"
        description={
          <>This permanently deletes “{deleting?.code}”.</>
        }
        blockedHint="Deactivate it instead to retire it without losing redemption history."
        onConfirm={() => api.adminCoupons.remove(deleting!.id)}
        onDeleted={() => {
          toast({ title: "Coupon deleted" });
          refetch();
        }}
      />
    </div>
  );
}
