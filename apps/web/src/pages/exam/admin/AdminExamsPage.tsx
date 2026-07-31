/**
 * Admin exams index (route: /admin/exams). Lists EVERY exam via the admin-only
 * GET /admin/exams (added in Step 2b) — no longer the enrollment-scoped student
 * feed. Row → editor; "New exam" opens the settings dialog.
 */
import { BookOpenCheck, ClipboardList, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ConfirmDeleteDialog } from "../../../components/curriculum/admin/ConfirmDeleteDialog.js";
import { ExamSettingsDialog } from "../../../components/exam/admin/ExamSettingsDialog.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Button } from "../../../components/ui/button.js";
import { Card } from "../../../components/ui/card.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { IconButton } from "../../../components/ui/icon-button.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { useToast } from "../../../components/ui/toast.js";
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

export function AdminExamsPage() {
  const { data, loading, error, refetch } = useQuery(
    () => api.adminExams.list(),
    [],
  );
  const items = data?.items ?? [];
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(
    null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exams"
        description="Author placement mocks: sections, questions, and coding test cases."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Open exam
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No exams yet"
          description="Create an exam-type topic under a course module, then open its exam here to author sections and questions."
          icon={<ClipboardList />}
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Open exam
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Exam</TableHead>
                <TableHead>Sections</TableHead>
                <TableHead>Questions</TableHead>
                <TableHead>Total marks</TableHead>
                <TableHead>Pass %</TableHead>
                <TableHead className="text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((exam) => (
                <TableRow key={exam.id}>
                  <TableCell>
                    <Link
                      to={`/admin/exams/${exam.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {exam.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {exam.sectionCount}
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {exam.questionCount}
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {exam.totalMarks}
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {exam.passPercentage}%
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" asChild>
                        <Link to={`/admin/exams/${exam.id}`}>
                          <BookOpenCheck className="h-4 w-4" /> Open
                        </Link>
                      </Button>
                      <IconButton
                        aria-label="Delete exam"
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                        onClick={() =>
                          setDeleting({ id: exam.id, title: exam.title })
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {creating ? (
        <ExamSettingsDialog
          open
          onOpenChange={setCreating}
          initial={null}
          onSaved={() => refetch()}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this exam?"
        noun="exam"
        description={
          <>
            This permanently deletes “{deleting?.title}” and all its sections,
            questions, test cases, and public links.
          </>
        }
        blockedHint="Delete a future/unattempted exam instead — this one has recorded attempts."
        onConfirm={() => api.adminExams.deleteExam(deleting!.id)}
        onDeleted={() => {
          toast({ title: "Exam deleted" });
          refetch();
        }}
      />
    </div>
  );
}
