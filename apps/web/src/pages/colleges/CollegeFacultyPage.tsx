/**
 * Faculty management (route: /c/:slug/faculty). Gated by the college's
 * `faculty_management` FEATURE entitlement — when it's off we show a clear
 * "not enabled" state rather than dead-ending (the backend also 403s). Lists
 * faculty with their assigned-scope shown as readable unit chips (resolved from
 * the org tree, not raw ids), and supports invite (with scope), edit-scope, and
 * soft deactivate / reactivate. Mirrors the admin list pages + editor-dialog
 * pattern.
 */
import {
  CollegeFeature,
  checkEntitlement,
  type Faculty,
} from "@codeapt/shared";
import { Lock, Plus, Users } from "lucide-react";
import { useState } from "react";

import { FacultyEditorDialog } from "../../components/colleges/FacultyEditorDialog.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
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
import { flattenTree } from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeFacultyPage() {
  const { slug, context } = useCollege();
  const { toast } = useToast();

  const enabled = checkEntitlement(
    context.entitlements,
    CollegeFeature.FACULTY_MANAGEMENT,
  );

  if (!enabled) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Faculty"
          description="Invite and manage faculty accounts."
        />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <Lock className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">
            Faculty management isn't enabled
          </h2>
          <p className="text-sm text-ink-muted">
            This feature isn't turned on for your college. Contact your CodeApt
            administrator to enable it.
          </p>
        </Card>
      </div>
    );
  }

  return <FacultyManager slug={slug} onToast={toast} />;
}

function FacultyManager({
  slug,
  onToast,
}: {
  slug: string;
  onToast: ReturnType<typeof useToast>["toast"];
}) {
  const facultyQuery = useQuery(() => api.collegeFaculty.list(slug), [slug]);
  const treeQuery = useQuery(() => api.collegeOrgUnits.listTree(slug), [slug]);

  const [editing, setEditing] = useState<Faculty | null | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);

  const faculty = facultyQuery.data?.items ?? [];
  const tree = treeQuery.data?.items ?? [];
  const unitById = new Map(flattenTree(tree).map((u) => [u.id, u]));

  async function setActive(f: Faculty, active: boolean) {
    setBusyId(f.id);
    try {
      if (active) {
        await api.collegeFaculty.update(slug, f.id, { isActive: true });
        onToast({ variant: "success", title: `${f.fullName} reactivated` });
      } else {
        await api.collegeFaculty.deactivate(slug, f.id);
        onToast({ variant: "success", title: `${f.fullName} deactivated` });
      }
      facultyQuery.refetch();
    } catch (err) {
      onToast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty"
        description="Invite faculty and assign the org-units they manage."
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="h-4 w-4" /> Invite faculty
          </Button>
        }
      />

      {facultyQuery.loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : facultyQuery.error ? (
        <Alert variant="error">{facultyQuery.error}</Alert>
      ) : faculty.length === 0 ? (
        <EmptyState
          title="No faculty yet"
          description="Invite your first faculty member and assign the parts of the structure they manage."
          icon={<Users />}
          action={
            <Button size="sm" onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4" /> Invite faculty
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
                <TableHead>Scope</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {faculty.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium text-ink">
                    {f.fullName}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-ink-secondary">{f.email}</div>
                    <div className="font-mono text-xs text-ink-muted">
                      @{f.username}
                    </div>
                  </TableCell>
                  <TableCell>
                    {f.orgUnitIds.length === 0 ? (
                      <span className="text-xs text-ink-muted">
                        No units assigned
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {f.orgUnitIds.map((id) => {
                          const u = unitById.get(id);
                          return (
                            <Badge
                              key={id}
                              variant="neutral"
                              title={u?.path ?? id}
                            >
                              {u?.name ?? "Unknown unit"}
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {f.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="warning">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(f)}
                      >
                        Edit scope
                      </Button>
                      {f.isActive ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === f.id}
                          onClick={() => void setActive(f, false)}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busyId === f.id}
                          onClick={() => void setActive(f, true)}
                        >
                          Reactivate
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

      {editing !== undefined ? (
        <FacultyEditorDialog
          key={editing?.id ?? "new"}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(undefined);
          }}
          slug={slug}
          initial={editing}
          tree={tree}
          onSaved={() => facultyQuery.refetch()}
        />
      ) : null}
    </div>
  );
}
