/**
 * Inline topics manager for one module — the payoff of the "N topics" seam left
 * in AdminSubjectEditorPage. Lists the module's topics (type-adaptive) with
 * up/down reorder, edit, delete (blocker-aware via ConfirmDeleteDialog), plus
 * per-type affordances: quiz → open the question sub-editor; exam → jump to the
 * linked exam editor. Single-level dialogs (no nesting) keep it legible.
 */
import { TopicType, type AdminModule, type AdminTopic } from "@codeapt/shared";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ListChecks,
  Pencil,
  Plus,
  SquareArrowOutUpRight,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../../lib/api-client.js";
import { topicTypeLabel } from "../../../lib/curriculum-admin-ui.js";
import { useQuery } from "../../../lib/use-query.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card } from "../../ui/card.js";
import { EmptyState } from "../../ui/empty-state.js";
import { IconButton } from "../../ui/icon-button.js";
import { Skeleton } from "../../ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table.js";
import { useToast } from "../../ui/toast.js";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";
import { QuizQuestionsDialog } from "./QuizQuestionsDialog.js";
import { TopicEditorDialog } from "./TopicEditorDialog.js";

export interface ModuleTopicsPanelProps {
  module: AdminModule;
  onClose: () => void;
  /** Bubble up so the subject/module counts refresh. */
  onChanged: () => void;
}

export function ModuleTopicsPanel({
  module,
  onClose,
  onChanged,
}: ModuleTopicsPanelProps) {
  const { toast } = useToast();
  const topicsQ = useQuery(
    () => api.adminCurriculum.topics.list(module.id),
    [module.id],
  );
  const topics = topicsQ.data?.items ?? [];

  const [editing, setEditing] = useState<AdminTopic | null | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<AdminTopic | null>(null);
  const [quizFor, setQuizFor] = useState<AdminTopic | null>(null);
  const [reordering, setReordering] = useState(false);

  const refresh = (): void => {
    topicsQ.refetch();
    onChanged();
  };

  const move = async (index: number, dir: -1 | 1): Promise<void> => {
    const next = index + dir;
    if (next < 0 || next >= topics.length) return;
    const ids = topics.map((t) => t.id);
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    setReordering(true);
    try {
      await api.adminCurriculum.topics.reorder(module.id, ids);
      topicsQ.refetch();
    } catch {
      toast({ variant: "error", title: "Could not reorder topics" });
    } finally {
      setReordering(false);
    }
  };

  return (
    <Card className="overflow-hidden border-primary/40">
      <div className="flex items-center justify-between gap-4 border-b border-subtle bg-surface-base p-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-ink">
            <ListChecks className="h-4 w-4 text-ink-muted" /> Topics —{" "}
            {module.name}
          </h3>
          <p className="text-xs text-ink-muted">
            {topics.length} topic{topics.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus className="h-4 w-4" /> New topic
          </Button>
          <IconButton
            aria-label="Close topics"
            variant="ghost"
            size="sm"
            icon={<X className="h-4 w-4" />}
            onClick={onClose}
          />
        </div>
      </div>

      {topicsQ.loading ? (
        <Skeleton className="m-4 h-28 rounded-xl" />
      ) : topicsQ.error ? (
        <div className="p-4">
          <Alert variant="error">{topicsQ.error}</Alert>
        </div>
      ) : topics.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No topics yet"
            description="Add a text, video, quiz, exam, or essay topic."
            icon={<ListChecks />}
            action={
              <Button size="sm" onClick={() => setEditing(null)}>
                <Plus className="h-4 w-4" /> New topic
              </Button>
            }
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Order</TableHead>
              <TableHead>Topic</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topics.map((t, i) => (
              <TableRow key={t.id}>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <IconButton
                      aria-label="Move up"
                      variant="ghost"
                      size="sm"
                      disabled={i === 0 || reordering}
                      icon={<ChevronUp className="h-4 w-4" />}
                      onClick={() => void move(i, -1)}
                    />
                    <IconButton
                      aria-label="Move down"
                      variant="ghost"
                      size="sm"
                      disabled={i === topics.length - 1 || reordering}
                      icon={<ChevronDown className="h-4 w-4" />}
                      onClick={() => void move(i, 1)}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-medium text-ink">{t.name}</div>
                  {t.topicType === TopicType.QUIZ ? (
                    <div className="text-xs text-ink-muted">
                      {t.questionCount} question
                      {t.questionCount === 1 ? "" : "s"}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant="info">{topicTypeLabel(t.topicType)}</Badge>
                </TableCell>
                <TableCell>
                  {t.isVisible ? (
                    <Badge variant="success">
                      <Eye className="h-3 w-3" /> Visible
                    </Badge>
                  ) : (
                    <Badge variant="neutral">
                      <EyeOff className="h-3 w-3" /> Hidden
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {t.topicType === TopicType.QUIZ ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setQuizFor(t)}
                      >
                        <ListChecks className="h-4 w-4" /> Questions (
                        {t.questionCount})
                      </Button>
                    ) : null}
                    {t.topicType === TopicType.EXAM && t.examId ? (
                      <Button size="sm" variant="ghost" asChild>
                        <Link to={`/admin/exams/${t.examId}`}>
                          <SquareArrowOutUpRight className="h-4 w-4" /> Open exam
                        </Link>
                      </Button>
                    ) : null}
                    <IconButton
                      aria-label="Edit topic"
                      variant="ghost"
                      size="sm"
                      icon={<Pencil className="h-4 w-4" />}
                      onClick={() => setEditing(t)}
                    />
                    <IconButton
                      aria-label="Delete topic"
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
      )}

      {/* Dialogs */}
      {editing !== undefined ? (
        <TopicEditorDialog
          key={editing?.id ?? "new"}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(undefined);
          }}
          moduleId={module.id}
          initial={editing}
          onSaved={refresh}
        />
      ) : null}

      {quizFor ? (
        <QuizQuestionsDialog
          open
          onOpenChange={(o) => {
            if (!o) setQuizFor(null);
          }}
          topicId={quizFor.id}
          topicName={quizFor.name}
          onChanged={refresh}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this topic?"
        noun="topic"
        description={<>This permanently deletes “{deleting?.name}”.</>}
        onConfirm={() => api.adminCurriculum.topics.remove(deleting!.id)}
        onDeleted={() => {
          toast({ title: "Topic deleted" });
          refresh();
        }}
      />
    </Card>
  );
}
