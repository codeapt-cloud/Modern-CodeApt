/**
 * Curriculum admin overview (route: /admin/curriculum). Two sections:
 *   1. Programs — ordered, with create/edit/delete and up/down reorder (reorder
 *      sends the full ordered id array, per the backend contract).
 *   2. Courses (subjects) — admin projection with price/popular/visible/module +
 *      enrollment counts, filterable by program; row → the subject editor where
 *      modules are managed. Subjects have no order field, so no reorder here.
 *
 * Destructive deletes go through ConfirmDeleteDialog, which turns the backend's
 * DELETE_BLOCKED 409 into a named-count message instead of a generic error.
 */
import {
  effectivePricePaise,
  formatINR,
  isFree as isFreePrice,
  type AdminProgram,
  type AdminSubject,
} from "@codeapt/shared";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FolderTree,
  GraduationCap,
  Layers,
  Pencil,
  Plus,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ConfirmDeleteDialog } from "../../../components/curriculum/admin/ConfirmDeleteDialog.js";
import { ProgramEditorDialog } from "../../../components/curriculum/admin/ProgramEditorDialog.js";
import { SubjectEditorDialog } from "../../../components/curriculum/admin/SubjectEditorDialog.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card } from "../../../components/ui/card.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { IconButton } from "../../../components/ui/icon-button.js";
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
import { api } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";

const ALL_PROGRAMS = "__all__";

function VisibilityBadge({ visible }: { visible: boolean }) {
  return visible ? (
    <Badge variant="success">
      <Eye className="h-3 w-3" /> Visible
    </Badge>
  ) : (
    <Badge variant="neutral">
      <EyeOff className="h-3 w-3" /> Hidden
    </Badge>
  );
}

function SubjectPrice({ subject }: { subject: AdminSubject }) {
  if (isFreePrice(subject.price, subject.discountPrice)) {
    return <span className="font-medium text-success-fg">Free</span>;
  }
  const effective = effectivePricePaise(subject.price, subject.discountPrice);
  const discounted =
    subject.discountPrice > 0 && subject.discountPrice < subject.price;
  return (
    <span className="flex items-baseline gap-2 font-mono">
      <span className="font-medium text-ink">{formatINR(effective)}</span>
      {discounted ? (
        <span className="text-xs text-ink-muted line-through">
          {formatINR(subject.price)}
        </span>
      ) : null}
    </span>
  );
}

export function AdminCurriculumPage() {
  const { toast } = useToast();

  const programsQ = useQuery(() => api.adminCurriculum.programs.list(), []);
  const programs = programsQ.data?.items ?? [];

  const [programFilter, setProgramFilter] = useState("");
  const subjectsQ = useQuery(
    () => api.adminCurriculum.subjects.list(programFilter || undefined),
    [programFilter],
  );
  const subjects = subjectsQ.data?.items ?? [];

  // undefined = closed; null = create; entity = edit.
  const [programEditing, setProgramEditing] = useState<
    AdminProgram | null | undefined
  >(undefined);
  const [programDeleting, setProgramDeleting] = useState<AdminProgram | null>(
    null,
  );
  const [subjectEditing, setSubjectEditing] = useState<
    AdminSubject | null | undefined
  >(undefined);
  const [subjectDeleting, setSubjectDeleting] = useState<AdminSubject | null>(
    null,
  );
  const [reordering, setReordering] = useState(false);

  const moveProgram = async (index: number, dir: -1 | 1): Promise<void> => {
    const next = index + dir;
    if (next < 0 || next >= programs.length) return;
    const ids = programs.map((p) => p.id);
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    setReordering(true);
    try {
      await api.adminCurriculum.programs.reorder(ids);
      programsQ.refetch();
    } catch {
      toast({ variant: "error", title: "Could not reorder programs" });
    } finally {
      setReordering(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Manage curriculum"
        description="Author the content tree: programs, courses, and their modules."
      />

      {/* --- Programs -------------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <FolderTree className="h-5 w-5 text-ink-muted" /> Programs
          </h2>
          <Button size="sm" onClick={() => setProgramEditing(null)}>
            <Plus className="h-4 w-4" /> New program
          </Button>
        </div>

        {programsQ.loading ? (
          <Skeleton className="h-40 w-full rounded-2xl" />
        ) : programsQ.error ? (
          <Alert variant="error">{programsQ.error}</Alert>
        ) : programs.length === 0 ? (
          <EmptyState
            title="No programs yet"
            description="Programs group related courses. Create one to get started."
            icon={<FolderTree />}
            action={
              <Button size="sm" onClick={() => setProgramEditing(null)}>
                <Plus className="h-4 w-4" /> New program
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Order</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Courses</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {programs.map((p, i) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <IconButton
                          aria-label="Move up"
                          variant="ghost"
                          size="sm"
                          disabled={i === 0 || reordering}
                          icon={<ChevronUp className="h-4 w-4" />}
                          onClick={() => void moveProgram(i, -1)}
                        />
                        <IconButton
                          aria-label="Move down"
                          variant="ghost"
                          size="sm"
                          disabled={i === programs.length - 1 || reordering}
                          icon={<ChevronDown className="h-4 w-4" />}
                          onClick={() => void moveProgram(i, 1)}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-ink">{p.name}</div>
                      <div className="font-mono text-xs text-ink-muted">
                        /{p.slug}
                      </div>
                    </TableCell>
                    <TableCell>
                      <VisibilityBadge visible={p.isVisible} />
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      {p.subjectCount}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <IconButton
                          aria-label="Edit program"
                          variant="ghost"
                          size="sm"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => setProgramEditing(p)}
                        />
                        <IconButton
                          aria-label="Delete program"
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                          onClick={() => setProgramDeleting(p)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      {/* --- Courses (subjects) --------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <GraduationCap className="h-5 w-5 text-ink-muted" /> Courses
          </h2>
          <div className="flex items-center gap-2">
            {programs.length > 0 ? (
              <Select
                value={programFilter ? programFilter : ALL_PROGRAMS}
                onValueChange={(v) =>
                  setProgramFilter(v === ALL_PROGRAMS ? "" : v)
                }
              >
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROGRAMS}>All programs</SelectItem>
                  {programs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button size="sm" onClick={() => setSubjectEditing(null)}>
              <Plus className="h-4 w-4" /> New course
            </Button>
          </div>
        </div>

        {subjectsQ.loading ? (
          <Skeleton className="h-56 w-full rounded-2xl" />
        ) : subjectsQ.error ? (
          <Alert variant="error">{subjectsQ.error}</Alert>
        ) : subjects.length === 0 ? (
          <EmptyState
            title="No courses yet"
            description="Create a course, then add modules to it."
            icon={<GraduationCap />}
            action={
              <Button size="sm" onClick={() => setSubjectEditing(null)}>
                <Plus className="h-4 w-4" /> New course
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>Modules</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjects.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        to={`/admin/curriculum/subjects/${s.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.name}
                      </Link>
                      <div className="font-mono text-xs text-ink-muted">
                        /{s.slug}
                      </div>
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      {s.programName ?? (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <SubjectPrice subject={s} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {s.isPopular ? (
                          <Badge variant="info">
                            <Star className="h-3 w-3" /> Popular
                          </Badge>
                        ) : null}
                        <VisibilityBadge visible={s.isVisible} />
                      </div>
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      <span className="inline-flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5" /> {s.moduleCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-ink-secondary">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" /> {s.enrollmentCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" asChild>
                          <Link to={`/admin/curriculum/subjects/${s.id}`}>
                            Open
                          </Link>
                        </Button>
                        <IconButton
                          aria-label="Edit course"
                          variant="ghost"
                          size="sm"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => setSubjectEditing(s)}
                        />
                        <IconButton
                          aria-label="Delete course"
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                          onClick={() => setSubjectDeleting(s)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      {/* --- Dialogs -------------------------------------------------------- */}
      {programEditing !== undefined ? (
        <ProgramEditorDialog
          key={programEditing?.id ?? "new"}
          open
          onOpenChange={(o) => {
            if (!o) setProgramEditing(undefined);
          }}
          initial={programEditing}
          onSaved={() => programsQ.refetch()}
        />
      ) : null}

      {subjectEditing !== undefined ? (
        <SubjectEditorDialog
          key={subjectEditing?.id ?? "new"}
          open
          onOpenChange={(o) => {
            if (!o) setSubjectEditing(undefined);
          }}
          initial={subjectEditing}
          defaultProgramId={programFilter || null}
          onSaved={() => {
            subjectsQ.refetch();
            programsQ.refetch();
          }}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={programDeleting !== null}
        onOpenChange={(o) => {
          if (!o) setProgramDeleting(null);
        }}
        title="Delete this program?"
        noun="program"
        description={
          <>
            This permanently deletes “{programDeleting?.name}”. Its courses are
            not deleted — they become unfiled.
          </>
        }
        onConfirm={() =>
          api.adminCurriculum.programs.remove(programDeleting!.id)
        }
        onDeleted={() => {
          toast({ title: "Program deleted" });
          programsQ.refetch();
          subjectsQ.refetch();
        }}
      />

      <ConfirmDeleteDialog
        open={subjectDeleting !== null}
        onOpenChange={(o) => {
          if (!o) setSubjectDeleting(null);
        }}
        title="Delete this course?"
        noun="course"
        description={
          <>This permanently deletes “{subjectDeleting?.name}”.</>
        }
        onConfirm={() =>
          api.adminCurriculum.subjects.remove(subjectDeleting!.id)
        }
        onDeleted={() => {
          toast({ title: "Course deleted" });
          subjectsQ.refetch();
          programsQ.refetch();
        }}
      />
    </div>
  );
}
