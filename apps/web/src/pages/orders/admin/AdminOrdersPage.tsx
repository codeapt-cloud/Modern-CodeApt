/**
 * Order ledger (route: /admin/orders). A paginated, filterable (by status) and
 * searchable (orderId / transactionId / coupon) list of the payment ledger;
 * each row opens a read-only detail dialog that surfaces gateway-owned fields
 * as read-only. Read-only — the order lifecycle is owned by the payment flow.
 */
import {
  PaymentStatus,
  formatINR,
  type AdminOrderListItem,
} from "@codeapt/shared";
import { Receipt, Search } from "lucide-react";
import { useState } from "react";

import {
  OrderDetailDialog,
  STATUS_LABEL,
  statusVariant,
} from "../../../components/orders/admin/OrderDetailDialog.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Card } from "../../../components/ui/card.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { Input } from "../../../components/ui/input.js";
import { Pagination } from "../../../components/ui/pagination.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { api } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";

const PAGE_SIZE = 20;
const ANY = "__any__";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export function AdminOrdersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ANY);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  const { data, loading, error } = useQuery(
    () =>
      api.adminOrders.list({
        q: q.trim(),
        page,
        pageSize: PAGE_SIZE,
        ...(status !== ANY ? { status: status as PaymentStatus } : {}),
      }),
    [q, status, page],
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Review the payment ledger. Gateway-owned fields (transaction id, status) are read-only — the order lifecycle is owned by the verified payment flow."
      />

      <div className="flex flex-col sm:flex-row flex-wrap gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            className="pl-9"
            placeholder="Search order id, transaction id, coupon…"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            {Object.values(PaymentStatus).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No orders match"
          description="Try a different search term or status filter."
          icon={<Receipt />}
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order id</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((o: AdminOrderListItem) => (
                  <TableRow
                    key={o.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(o.id)}
                  >
                    <TableCell className="font-mono text-xs text-ink-secondary">
                      {o.orderId}
                    </TableCell>
                    <TableCell className="font-medium text-ink">
                      {o.student}
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      {o.subject}
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      {formatINR(o.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(o.status)}>
                        {STATUS_LABEL[o.status] ?? o.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      {fmtDate(o.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-muted">
              {total} order{total === 1 ? "" : "s"}
            </p>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        </>
      )}

      {selected ? (
        <OrderDetailDialog
          orderId={selected}
          onOpenChange={(o) => {
            if (!o) setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
