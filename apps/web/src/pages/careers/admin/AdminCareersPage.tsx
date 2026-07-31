/**
 * Admin posting authoring (route: /admin/careers). Lists every posting with its
 * status + application count and the authoring actions: create/edit (dialog),
 * publish/close, delete (confirm), and a link into application review. Consumes
 * the admin API only; the server enforces requireAdmin.
 */
import type { AdminPosting } from "@codeapt/shared";
import {
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { PostingEditorDialog } from "../../../components/careers/PostingEditorDialog.js";
import { ConfirmDeleteDialog } from "../../../components/curriculum/admin/ConfirmDeleteDialog.js";
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
import { useToast } from "../../../components/ui/toast.js";
import { api, parseApiError } from "../../../lib/api-client.js";
import { postingTypeLabel } from "../../../lib/careers-ui.js";
import { useQuery } from "../../../lib/use-query.js";

export function AdminCareersPage() {
  const { toast } = useToast();
  const { data, loading, error, refetch } = useQuery(
    () => api.adminCareers.list(),
    [],
  );
  const items = data?.items ?? [];

  // `editing`: undefined = closed; null = create; AdminPosting = edit.
  const [editing, setEditing] = useState<AdminPosting | null | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<AdminPosting | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const togglePublish = async (posting: AdminPosting): Promise<void> => {
    setBusyId(posting.id);
    try {
      if (posting.isActive) {
        await api.adminCareers.close(posting.id);
        toast({ title: "Posting closed" });
      } else {
        await api.adminCareers.publish(posting.id);
        toast({ variant: "success", title: "Posting published" });
      }
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
        title="Manage postings"
        description="Create and manage job & placement postings and review applicants."
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="h-4 w-4" /> New posting
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No postings yet"
          description="Create your first posting to start collecting applications."
          icon={<Users />}
          action={
            <Button size="sm" onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4" /> New posting
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Posting</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Apply</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Applicants</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium text-ink">{p.title}</div>
                    <div className="text-xs text-ink-muted">{p.company}</div>
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {postingTypeLabel(p.type)}
                  </TableCell>
                  <TableCell>
                    {p.applyUrl ? (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                        <ExternalLink className="h-3.5 w-3.5" /> External
                      </span>
                    ) : (
                      <span className="text-xs text-ink-muted">In-app</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.isActive ? (
                      <Badge variant="success">Published</Badge>
                    ) : (
                      <Badge variant="neutral">Draft</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.applyUrl ? (
                      <span className="text-xs text-ink-muted">—</span>
                    ) : (
                      <Link
                        to={`/admin/careers/${p.id}/applications`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        <Users className="h-4 w-4" /> {p.applicationCount}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void togglePublish(p)}
                        loading={busyId === p.id}
                      >
                        {p.isActive ? "Close" : "Publish"}
                      </Button>
                      <IconButton
                        aria-label="Edit posting"
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => setEditing(p)}
                      />
                      <IconButton
                        aria-label="Delete posting"
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                        onClick={() => setDeleting(p)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Editor — keyed so the form resets to the current target on open. */}
      {editing !== undefined ? (
        <PostingEditorDialog
          key={editing?.id ?? "new"}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(undefined);
          }}
          initial={editing}
          onSaved={refetch}
        />
      ) : null}

      {/* Reference-safe delete — blocked when applications exist (close instead). */}
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this posting?"
        noun="posting"
        description={
          <>
            This permanently deletes “{deleting?.title}”. It has no applications,
            so nothing is lost.
          </>
        }
        blockedHint="Close it instead to retire it without losing applicant history."
        onConfirm={() => api.adminCareers.remove(deleting!.id)}
        onDeleted={() => {
          toast({ title: "Posting deleted" });
          refetch();
        }}
      />
    </div>
  );
}
