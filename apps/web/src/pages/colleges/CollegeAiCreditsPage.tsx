/**
 * AI credit distribution (college_admin, route: /c/:slug/ai-credits for an
 * operator) — carve the Stage-1 college pool into per-student allocations. Shows
 * pool / allocated / distributable, a per-student list (with inline set/clear),
 * and a bulk ALLOCATE form that reuses the shared student selector (multi-select
 * org-units + individuals + Excel roll-number upload with matched/unmatched
 * preview) + an amount (SET-semantics). Over-allocation is rejected with a clear
 * distributable figure. Read-only over stored ledgers; no live AI.
 */
import {
  CollegeFeature,
  Role,
  checkEntitlement,
} from "@codeapt/shared";
import { Coins, Users } from "lucide-react";
import { useState } from "react";

import {
  GroupMemberSelector,
  type ExcelPreview,
} from "../../components/colleges/GroupMemberSelector.js";
import { StatCard } from "../../components/colleges/StatCard.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Input } from "../../components/ui/input.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Switch } from "../../components/ui/switch.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeAiCreditsPage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();
  const entitled = checkEntitlement(context.entitlements, CollegeFeature.AI);
  const isAdmin =
    context.membership.role === Role.COLLEGE_ADMIN ||
    context.membership.role === Role.ADMIN ||
    context.membership.role === Role.SUPER_ADMIN;

  const q = useQuery(
    () =>
      entitled && isAdmin
        ? api.aiCreditDistribution.get(slug)
        : Promise.resolve(null),
    [slug, entitled, isAdmin],
  );

  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [unitIds, setUnitIds] = useState<Set<string>>(new Set());
  const [studentIds, setStudentIds] = useState<Set<string>>(new Set());
  const [excel, setExcel] = useState<ExcelPreview | null>(null);
  const [rowAmounts, setRowAmounts] = useState<Record<string, string>>({});

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader title="AI credits" description="Distribute AI credits to students." />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <Coins className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">AI isn&apos;t enabled</h2>
          <p className="text-sm text-ink-muted">Your college doesn&apos;t have the AI feature.</p>
        </Card>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="AI credits" description="Distribute AI credits to students." />
        <Alert variant="info">
          Only a college administrator can manage AI credit distribution.
        </Alert>
      </div>
    );
  }

  const data = q.data;

  const toggleMode = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    try {
      await api.aiCreditDistribution.setEnabled(slug, enabled);
      q.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const allocate = async (body: {
    orgUnitIds?: string[];
    studentIds?: string[];
    excelRollNumbers?: string[];
    amount: number;
  }): Promise<void> => {
    setBusy(true);
    try {
      await api.aiCreditDistribution.allocate(slug, body);
      toast({ variant: "success", title: "Allocation saved" });
      q.refetch();
    } catch (err) {
      const parsed = parseApiError(err);
      const details = parsed.details as
        | { distributable?: number; requested?: number }
        | undefined;
      toast({
        variant: "error",
        title:
          parsed.code === "OVER_ALLOCATION" && details
            ? `Over pool: need ${details.requested}, only ${details.distributable} distributable`
            : parsed.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const runBulkAllocate = async (): Promise<void> => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      toast({ variant: "error", title: "Enter a valid amount" });
      return;
    }
    const total = unitIds.size + studentIds.size + (excel?.matchedRolls.length ?? 0);
    if (total === 0) {
      toast({ variant: "error", title: "Select students (org-unit, individuals, or Excel)" });
      return;
    }
    await allocate({
      orgUnitIds: [...unitIds],
      studentIds: [...studentIds],
      excelRollNumbers: excel?.matchedRolls ?? [],
      amount: amt,
    });
    setUnitIds(new Set());
    setStudentIds(new Set());
    setExcel(null);
    setAmount("");
  };

  const selectedCount = unitIds.size + studentIds.size + (excel?.matchedRolls.length ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI credits"
        description="Distribute your college's AI credit pool to specific students."
        actions={
          <label className="flex items-center gap-2 text-sm text-ink">
            <Switch
              checked={data?.enabled ?? false}
              disabled={busy || !data}
              onCheckedChange={(v) => void toggleMode(v)}
            />
            Per-student distribution
          </label>
        }
      />

      {q.loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : q.error ? (
        <Alert variant="error">{q.error}</Alert>
      ) : !data ? null : (
        <>
          {!data.enabled ? (
            <Alert variant="info">
              Per-student distribution is off — students draw the college pool directly.
              Turn it on to allocate credits to specific students (then unallocated
              students get no AI).
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Coins} label="Pool this period" value={data.poolAllocated} />
            <StatCard icon={Users} label="Allocated to students" value={data.allocatedToStudents} />
            <StatCard icon={Coins} label="Distributable" value={data.distributable} />
            <StatCard icon={Coins} label="Used by students" value={data.consumedByStudents} />
          </div>

          {/* Bulk allocate — reuse the shared multi-select selector */}
          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Allocate credits</h3>
                <p className="text-xs text-ink-muted">
                  Pick students by org-units, individuals, and/or an Excel upload —
                  each selected student&apos;s allocation is SET to the amount.
                </p>
              </div>
              <div className="flex items-end gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-ink-secondary">
                    Amount (per student)
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-32"
                    placeholder="e.g. 50"
                  />
                </div>
                <Button loading={busy} onClick={() => void runBulkAllocate()}>
                  Allocate to {selectedCount || "…"}
                </Button>
              </div>
            </div>
            <GroupMemberSelector
              slug={slug}
              unitIds={unitIds}
              onUnitIdsChange={setUnitIds}
              studentIds={studentIds}
              onStudentIdsChange={setStudentIds}
              excel={excel}
              onExcelChange={setExcel}
              previewFetcher={(s, f) => api.aiCreditDistribution.importPreview(s, f)}
              templateFetcher={(s) => api.aiCreditDistribution.template(s)}
            />
          </Card>

          {/* Per-student list */}
          {data.students.length === 0 ? (
            <EmptyState
              title="No students allocated yet"
              description="Allocate credits above; each student who receives an allocation appears here."
              icon={<Users />}
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="border-b border-subtle p-4">
                <h3 className="text-sm font-semibold text-ink">Per-student allocations</h3>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Roll</TableHead>
                    <TableHead>Allocated</TableHead>
                    <TableHead>Used</TableHead>
                    <TableHead>Remaining</TableHead>
                    <TableHead>Set</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.students.map((s) => (
                    <TableRow key={s.studentId}>
                      <TableCell className="text-ink">{s.fullName || "—"}</TableCell>
                      <TableCell className="font-mono text-ink-secondary">{s.rollNumber}</TableCell>
                      <TableCell className="tabular-nums text-ink-secondary">{s.allocated}</TableCell>
                      <TableCell className="tabular-nums text-ink-secondary">{s.consumed}</TableCell>
                      <TableCell>
                        <Badge variant={s.remaining === 0 ? "warning" : "success"}>
                          {s.remaining}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            value={rowAmounts[s.studentId] ?? ""}
                            onChange={(e) =>
                              setRowAmounts((m) => ({ ...m, [s.studentId]: e.target.value }))
                            }
                            className="w-24"
                            placeholder={String(s.allocated)}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            loading={busy}
                            onClick={() => {
                              const raw = rowAmounts[s.studentId];
                              const amt = Number(raw);
                              if (raw === undefined || raw === "" || !Number.isFinite(amt) || amt < 0) {
                                toast({ variant: "error", title: "Enter a valid amount" });
                                return;
                              }
                              void allocate({ studentIds: [s.studentId], amount: amt });
                            }}
                          >
                            Set
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
