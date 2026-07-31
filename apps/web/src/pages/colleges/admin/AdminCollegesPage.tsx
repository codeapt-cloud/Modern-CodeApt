/**
 * College console — list (route: /admin/colleges). Platform-admin control plane:
 * every college with its slug, status, enabled-feature summary and granted-
 * course count; create via the editor dialog; "Manage" opens the per-college
 * entitlement control panel. Mirrors the other admin list pages (PageHeader +
 * useQuery + Card/Table + loading/empty/error states).
 */
import { CollegeStatus, type College } from "@codeapt/shared";
import {
  Building2,
  ExternalLink,
  Pencil,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { CollegeEditorDialog } from "../../../components/colleges/admin/CollegeEditorDialog.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card } from "../../../components/ui/card.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { IconButton } from "../../../components/ui/icon-button.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import {
  enabledFeatureCount,
  TOTAL_FEATURE_COUNT,
} from "../../../lib/entitlements-ui.js";
import { api } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";

function StatusBadge({ status }: { status: College["status"] }) {
  return status === CollegeStatus.ACTIVE ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="warning">Suspended</Badge>
  );
}

export function AdminCollegesPage() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useQuery(
    () => api.adminColleges.list(),
    [],
  );
  const items = data?.items ?? [];

  // undefined = closed; null = create.
  const [editing, setEditing] = useState<College | null | undefined>(undefined);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colleges"
        description="Provision college tenants and control each one's features, sub-capabilities and granted courses."
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="h-4 w-4" /> New college
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No colleges yet"
          description="Provision your first college, then grant it features and courses."
          icon={<Building2 />}
          action={
            <Button size="sm" onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4" /> New college
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Features</TableHead>
                <TableHead>Courses</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/admin/colleges/${c.id}`)}
                >
                  <TableCell className="font-medium text-ink">
                    {c.name}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-ink-secondary">
                      {c.slug}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {enabledFeatureCount(c.entitlements)} / {TOTAL_FEATURE_COUNT}
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {c.entitlements.grantedCourses.length}
                  </TableCell>
                  <TableCell className="text-xs text-ink-muted">
                    {c.createdAt.slice(0, 10)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/c/${c.slug}/structure`)}
                      >
                        <ExternalLink className="h-4 w-4" /> Open workspace
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(`/admin/colleges/${c.id}`)}
                      >
                        <SlidersHorizontal className="h-4 w-4" /> Manage
                      </Button>
                      <IconButton
                        aria-label="Edit basics"
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => setEditing(c)}
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
        <CollegeEditorDialog
          key={editing?.id ?? "new"}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(undefined);
          }}
          initial={editing}
          onSaved={() => refetch()}
        />
      ) : null}
    </div>
  );
}
