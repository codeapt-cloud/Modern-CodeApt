/**
 * Daily-challenge admin (route: /admin/challenges). Lists every scheduled
 * DailyQuestion by release date with type, marks, test-case + submission counts;
 * create/edit via the editor dialog; bulk-import (auto-scheduling) via the
 * import dialog; delete via the shared ConfirmDeleteDialog, which renders the
 * DELETE_BLOCKED 409 (scored submissions) with a reschedule hint.
 */
import {
  DailyChallengeSource,
  DailyQuestionType,
  type AdminChallengeListItem,
} from "@codeapt/shared";
import {
  Flame,
  FileUp,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { BulkImportChallengesDialog } from "../../../components/challenges/admin/BulkImportChallengesDialog.js";
import { ChallengeEditorDialog } from "../../../components/challenges/admin/ChallengeEditorDialog.js";
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
import { api } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";

/** Provenance badge: how a challenge came to be published. */
const SOURCE_META: Record<
  string,
  { label: string; variant: "primary" | "neutral" | "warning" | "success" }
> = {
  [DailyChallengeSource.AI]: { label: "AI", variant: "success" },
  [DailyChallengeSource.BANK_FALLBACK]: {
    label: "Bank fallback",
    variant: "warning",
  },
  [DailyChallengeSource.CURATED_FALLBACK]: {
    label: "Curated fallback",
    variant: "warning",
  },
  [DailyChallengeSource.MANUAL]: { label: "Manual", variant: "neutral" },
};

export function AdminChallengesPage() {
  const { toast } = useToast();
  const { data, loading, error, refetch } = useQuery(
    () => api.adminChallenges.list(),
    [],
  );
  const items = data?.items ?? [];

  // undefined → editor closed; null → create; string → edit that id.
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<AdminChallengeListItem | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const regenerate = async (releaseDate: string): Promise<void> => {
    setRegenerating(releaseDate);
    try {
      await api.adminChallenges.regenerate(releaseDate);
      toast({
        title: "Regeneration queued",
        description:
          "The generator is running (AI + validation, else a bank/curated fallback). Refresh in a moment.",
      });
    } catch {
      toast({ variant: "error", title: "Couldn't queue regeneration" });
    } finally {
      setRegenerating(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily challenges"
        description="Auto-generated every day at 00:01 IST (AI + validation, with a curated fallback). Schedule or override manually below — one per day, MCQ or code."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <FileUp className="h-4 w-4" /> Bulk import
            </Button>
            <Button onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4" /> Schedule challenge
            </Button>
          </div>
        }
      />

      {loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No challenges scheduled"
          description="Schedule a daily challenge, or bulk-import a workbook to auto-schedule several across dates."
          icon={<Flame />}
          action={
            <Button size="sm" onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4" /> Schedule challenge
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Marks</TableHead>
                <TableHead>Test cases</TableHead>
                <TableHead>Submissions</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs text-ink-secondary">
                    {c.releaseDate}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        c.questionType === DailyQuestionType.CODE
                          ? "primary"
                          : "neutral"
                      }
                    >
                      {c.questionType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={SOURCE_META[c.source]?.variant ?? "neutral"}>
                      {SOURCE_META[c.source]?.label ?? c.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-ink">{c.title}</div>
                  </TableCell>
                  <TableCell className="text-ink-secondary">{c.marks}</TableCell>
                  <TableCell className="text-ink-secondary">
                    {c.questionType === DailyQuestionType.CODE
                      ? c.testCaseCount
                      : "—"}
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {c.submissionCount}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        aria-label="Regenerate (re-run the auto pipeline)"
                        title="Regenerate for this day"
                        variant="ghost"
                        size="sm"
                        loading={regenerating === c.releaseDate}
                        disabled={regenerating === c.releaseDate}
                        icon={<RefreshCw className="h-4 w-4" />}
                        onClick={() => void regenerate(c.releaseDate)}
                      />
                      <IconButton
                        aria-label="Edit challenge"
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => setEditing(c.id)}
                      />
                      <IconButton
                        aria-label="Delete challenge"
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
        <ChallengeEditorDialog
          key={editing ?? "new"}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(undefined);
          }}
          editingId={editing}
          onSaved={refetch}
        />
      ) : null}

      <BulkImportChallengesDialog
        open={importing}
        onOpenChange={setImporting}
        onUploaded={refetch}
      />

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this challenge?"
        noun="challenge"
        description={
          <>
            This permanently deletes “{deleting?.title}” ({deleting?.releaseDate})
            and its test cases.
          </>
        }
        blockedHint="Reschedule it (edit the date) instead — deleting would destroy students' scores."
        onConfirm={() => api.adminChallenges.remove(deleting!.id)}
        onDeleted={() => {
          toast({ title: "Challenge deleted" });
          refetch();
        }}
      />
    </div>
  );
}
