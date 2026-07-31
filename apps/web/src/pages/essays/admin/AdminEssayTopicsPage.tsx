/**
 * Essay-prompt admin (route: /admin/essay-topics). Lists every EssayTopic with
 * difficulty, word/time bounds, keyword count, attempts, and active state;
 * create/edit via the editor dialog; a one-click active toggle (the retire path
 * for a prompt with attempts); delete via the shared ConfirmDeleteDialog, which
 * renders the DELETE_BLOCKED 409 (student attempts) with a deactivate hint.
 * Authoring here populates the curriculum essay-topic picker (loop closed).
 */
import {
  EssayDifficulty,
  type AdminEssayTopic,
  type EssayDifficulty as EssayDifficultyT,
} from "@codeapt/shared";
import { Pencil, PenLine, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDeleteDialog } from "../../../components/curriculum/admin/ConfirmDeleteDialog.js";
import { EssayTopicEditorDialog } from "../../../components/essays/admin/EssayTopicEditorDialog.js";
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

const DIFFICULTY_LABEL: Record<EssayDifficultyT, string> = {
  [EssayDifficulty.EASY]: "Easy",
  [EssayDifficulty.MEDIUM]: "Medium",
  [EssayDifficulty.HARD]: "Hard",
};

export function AdminEssayTopicsPage() {
  const { toast } = useToast();
  const { data, loading, error, refetch } = useQuery(
    () => api.adminEssayTopics.list(),
    [],
  );
  const items = data?.items ?? [];

  const [editing, setEditing] = useState<AdminEssayTopic | null | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<AdminEssayTopic | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggleActive = async (t: AdminEssayTopic): Promise<void> => {
    setBusyId(t.id);
    try {
      await api.adminEssayTopics.setActive(t.id, !t.isActive);
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
        title="Essay prompts"
        description="Author the essay prompts students write against — they feed the curriculum essay-topic picker."
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="h-4 w-4" /> New prompt
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No essay prompts yet"
          description="Create a prompt (with reference keywords) — it becomes selectable on essay-type curriculum topics."
          icon={<PenLine />}
          action={
            <Button size="sm" onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4" /> New prompt
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prompt</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead>Words</TableHead>
                <TableHead>Keywords</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium text-ink">{t.title}</div>
                    {t.linkedTopicCount > 0 ? (
                      <div className="text-xs text-ink-muted">
                        linked by {t.linkedTopicCount} curriculum topic
                        {t.linkedTopicCount === 1 ? "" : "s"}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">
                      {DIFFICULTY_LABEL[t.difficultyLevel]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-ink-muted">
                    {t.minWords}–{t.maxWords || "∞"}
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {t.semanticKeywords.length}
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {t.attemptCount}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={t.isActive}
                      disabled={busyId === t.id}
                      onCheckedChange={() => void toggleActive(t)}
                      aria-label={`Toggle ${t.title} active`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        aria-label="Edit prompt"
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => setEditing(t)}
                      />
                      <IconButton
                        aria-label="Delete prompt"
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                        onClick={() => setDeleting(t)}
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
        <EssayTopicEditorDialog
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
        title="Delete this essay prompt?"
        noun="essay prompt"
        description={
          <>
            This permanently deletes “{deleting?.title}”. Any curriculum topics
            linking it are unlinked (not deleted).
          </>
        }
        blockedHint="Deactivate it instead to retire it without losing student attempts."
        onConfirm={() => api.adminEssayTopics.remove(deleting!.id)}
        onDeleted={() => {
          toast({ title: "Essay prompt deleted" });
          refetch();
        }}
      />
    </div>
  );
}
