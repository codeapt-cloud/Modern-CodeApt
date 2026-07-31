/**
 * User admin (route: /admin/users). A searchable, paginated user list (search
 * spans name / username / email / roll / college) with a role filter; each row
 * opens a read-only detail dialog; a header action downloads the per-college
 * performance workbook. Read/reporting only — no destructive actions.
 */
import { Role, type AdminUserListItem } from "@codeapt/shared";
import { Download, Search, Users } from "lucide-react";
import { useState } from "react";

import { UserDetailDialog } from "../../../components/users/admin/UserDetailDialog.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
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
import { useToast } from "../../../components/ui/toast.js";
import { api, parseApiError } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";

const PAGE_SIZE = 20;
const ROLE_ANY = "__any__";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export function AdminUsersPage() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<string>(ROLE_ANY);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data, loading, error, refetch } = useQuery(
    () =>
      api.adminUsers.list({
        q: q.trim(),
        page,
        pageSize: PAGE_SIZE,
        ...(role !== ROLE_ANY ? { role: role as Role } : {}),
      }),
    [q, role, page],
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportPerformance = async (): Promise<void> => {
    setExporting(true);
    try {
      const { blob, filename } = await api.adminUsers.performanceBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Performance exported" });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Search students and staff, review a learner's activity, and export per-college performance."
        actions={
          <Button
            variant="secondary"
            loading={exporting}
            onClick={() => void exportPerformance()}
          >
            <Download className="h-4 w-4" /> Export per-college performance
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            className="pl-9"
            placeholder="Search name, username, email, roll, college…"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
        </div>
        <Select
          value={role}
          onValueChange={(v) => {
            setPage(1);
            setRole(v);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ROLE_ANY}>All roles</SelectItem>
            <SelectItem value={Role.STUDENT}>Students</SelectItem>
            <SelectItem value={Role.ADMIN}>Admins</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No users match"
          description="Try a different search term or role filter."
          icon={<Users />}
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>College</TableHead>
                  <TableHead>Roll</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((u: AdminUserListItem) => (
                  <TableRow
                    key={u.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(u.id)}
                  >
                    <TableCell>
                      <div className="font-medium text-ink">
                        {u.fullName || "—"}
                      </div>
                      <div className="text-xs text-ink-muted">{u.email}</div>
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      {u.username}
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      {u.collegeName || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-ink-secondary">
                      {u.rollNumber || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.role === Role.ADMIN ? "primary" : "neutral"}>
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      {fmtDate(u.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-muted">
              {total} user{total === 1 ? "" : "s"}
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
        <UserDetailDialog
          userId={selected}
          onOpenChange={(o) => {
            if (!o) setSelected(null);
          }}
          onChanged={refetch}
        />
      ) : null}
    </div>
  );
}
