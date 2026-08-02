/**
 * College students (route: /c/:slug/students). A scope-aware roster: faculty see
 * their in-scope students, college_admin sees all (the backend enforces this).
 * Shows name, login/email, roll number, org-unit (readable path resolved from the
 * tree — never a raw id) and status, with an org-unit filter, single-add, and a
 * soft deactivate. The bulk-import surface is shown only when the college has the
 * `bulk_import` feature (else a clear note); the backend also 403s.
 *
 * Mirrors the Phase 2b college pages (useCollege context, useQuery, toasts, the
 * editor-dialog pattern).
 */
import {
  CollegeFeature,
  checkEntitlement,
  type CollegeStudent,
} from "@codeapt/shared";
import { GraduationCap, Plus, Upload } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { StudentEditorDialog } from "../../components/colleges/StudentEditorDialog.js";
import { StudentImportDialog } from "../../components/colleges/StudentImportDialog.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { Skeleton } from "../../components/ui/skeleton.js";
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
import { flattenTree, orgUnitTypeLabel } from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const ALL = "__all__";

export function CollegeStudentsPage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();

  const canImport = checkEntitlement(
    context.entitlements,
    CollegeFeature.BULK_IMPORT,
  );

  // The "Bulk import" nav entry / dashboard tile deep-links here with ?import=1,
  // so landing from those opens the import flow directly (only when entitled).
  const [searchParams] = useSearchParams();
  const [orgUnitFilter, setOrgUnitFilter] = useState<string>(ALL);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CollegeStudent | null>(null);
  const [importOpen, setImportOpen] = useState(
    () => canImport && searchParams.get("import") === "1",
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const treeQuery = useQuery(() => api.collegeOrgUnits.listTree(slug), [slug]);
  const tree = treeQuery.data?.items ?? [];
  const flat = flattenTree(tree);
  const unitById = new Map(flat.map((u) => [u.id, u]));

  const studentsQuery = useQuery(
    () =>
      api.collegeStudents.list(
        slug,
        orgUnitFilter === ALL ? {} : { orgUnitId: orgUnitFilter },
      ),
    [slug, orgUnitFilter],
  );
  const students = studentsQuery.data?.items ?? [];

  async function deactivate(s: CollegeStudent) {
    setBusyId(s.id);
    try {
      await api.collegeStudents.deactivate(slug, s.id);
      toast({ variant: "success", title: `${s.fullName} deactivated` });
      studentsQuery.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusyId(null);
    }
  }

  async function activate(s: CollegeStudent) {
    setBusyId(s.id);
    try {
      await api.collegeStudents.update(slug, s.id, { isActive: true });
      toast({ variant: "success", title: `${s.fullName} activated` });
      studentsQuery.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusyId(null);
    }
  }

  const unitLabel = (id: string | null): string => {
    if (!id) return "—";
    return unitById.get(id)?.path ?? "Unknown unit";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Add students individually or import a batch. You see the students within your scope."
        actions={
          <>
            {canImport ? (
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import students
              </Button>
            ) : null}
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add student
            </Button>
          </>
        }
      />

      {!canImport ? (
        <Alert variant="info">
          Bulk import isn&apos;t enabled for your college — you can still add
          students individually. Contact your CodeApt administrator to enable
          imports.
        </Alert>
      ) : null}

      {/* Filter */}
      {flat.length > 0 ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="text-sm text-ink-muted">Org-unit</span>
          <Select value={orgUnitFilter} onValueChange={setOrgUnitFilter}>
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All units</SelectItem>
              {flat.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.path}{" "}
                  <span className="text-ink-muted">
                    ({orgUnitTypeLabel(u.type)})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {studentsQuery.loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : studentsQuery.error ? (
        <Alert variant="error">{studentsQuery.error}</Alert>
      ) : students.length === 0 ? (
        <EmptyState
          title="No students yet"
          description={
            orgUnitFilter === ALL
              ? "Add your first student, or import a batch."
              : "No students in this org-unit."
          }
          icon={<GraduationCap />}
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add student
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Roll</TableHead>
                <TableHead>Org-unit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium text-ink">
                    {s.fullName}
                  </TableCell>
                  <TableCell className="text-sm text-ink-secondary">
                    {s.email}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink-secondary">
                    {s.rollNumber}
                  </TableCell>
                  <TableCell className="text-xs text-ink-secondary">
                    {unitLabel(s.orgUnitId)}
                  </TableCell>
                  <TableCell>
                    {s.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="warning">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(s)}
                      >
                        Edit
                      </Button>
                      {s.isActive ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === s.id}
                          onClick={() => void deactivate(s)}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === s.id}
                          onClick={() => void activate(s)}
                        >
                          Activate
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {addOpen ? (
        <StudentEditorDialog
          open
          onOpenChange={setAddOpen}
          slug={slug}
          initial={null}
          tree={tree}
          onSaved={() => studentsQuery.refetch()}
        />
      ) : null}

      {editing ? (
        <StudentEditorDialog
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          slug={slug}
          initial={editing}
          tree={tree}
          onSaved={() => studentsQuery.refetch()}
        />
      ) : null}

      {importOpen ? (
        <StudentImportDialog
          open
          onOpenChange={setImportOpen}
          slug={slug}
          onCommitted={() => studentsQuery.refetch()}
        />
      ) : null}
    </div>
  );
}
