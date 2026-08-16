/**
 * Subject editor (route: /admin/curriculum/subjects/:subjectId). Shows the
 * course's details (with an "Edit details" dialog covering every field) and
 * manages its MODULES: create/edit/delete + up/down reorder (scoped to this
 * subject). Each module row opens an inline ModuleTopicsPanel (4b-ii) for
 * type-adaptive topic authoring and the quiz sub-editor.
 */
import {
  effectivePricePaise,
  formatINR,
  isFree as isFreePrice,
  type AdminModule,
} from "@codeapt/shared";
import {
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FileUp,
  Layers,
  ListTree,
  Pencil,
  Plus,
  Star,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { BulkEnrollDialog } from "../../../components/curriculum/admin/BulkEnrollDialog.js";
import { BulkUploadTopicsDialog } from "../../../components/curriculum/admin/BulkUploadTopicsDialog.js";
import { ConfirmDeleteDialog } from "../../../components/curriculum/admin/ConfirmDeleteDialog.js";
import { ModuleEditorDialog } from "../../../components/curriculum/admin/ModuleEditorDialog.js";
import { ModuleTopicsPanel } from "../../../components/curriculum/admin/ModuleTopicsPanel.js";
import { SubjectEditorDialog } from "../../../components/curriculum/admin/SubjectEditorDialog.js";
import { SubjectEnrollmentsTab } from "../../../components/curriculum/admin/SubjectEnrollmentsTab.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card } from "../../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../components/ui/tabs.js";
import { useToast } from "../../../components/ui/toast.js";
import { api, parseApiError } from "../../../lib/api-client.js";
import { imageUrl } from "../../../lib/cloudinary.js";
import { useQuery } from "../../../lib/use-query.js";

export function AdminSubjectEditorPage() {
  const { subjectId = "" } = useParams();
  const { toast } = useToast();

  const subjectQ = useQuery(
    () => api.adminCurriculum.subjects.get(subjectId),
    [subjectId],
  );
  const modulesQ = useQuery(
    () => api.adminCurriculum.modules.list(subjectId),
    [subjectId],
  );
  const subject = subjectQ.data;
  const modules = modulesQ.data?.items ?? [];

  const [editingDetails, setEditingDetails] = useState(false);
  const [moduleEditing, setModuleEditing] = useState<
    AdminModule | null | undefined
  >(undefined);
  const [moduleDeleting, setModuleDeleting] = useState<AdminModule | null>(
    null,
  );
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [recomputeOpen, setRecomputeOpen] = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  const openModule = modules.find((m) => m.id === openModuleId) ?? null;

  const runRecompute = async (): Promise<void> => {
    setRecomputing(true);
    try {
      const res =
        await api.adminCurriculum.subjects.recomputeExpiry(subjectId);
      toast({
        variant: "success",
        title:
          `Updated ${res.updated} enrolment${res.updated === 1 ? "" : "s"}` +
          (res.expired > 0 ? ` · ${res.expired} now expired` : ""),
      });
      setRecomputeOpen(false);
      subjectQ.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setRecomputing(false);
    }
  };

  const moveModule = async (index: number, dir: -1 | 1): Promise<void> => {
    const next = index + dir;
    if (next < 0 || next >= modules.length) return;
    const ids = modules.map((m) => m.id);
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    setReordering(true);
    try {
      await api.adminCurriculum.modules.reorder(subjectId, ids);
      modulesQ.refetch();
    } catch {
      toast({ variant: "error", title: "Could not reorder modules" });
    } finally {
      setReordering(false);
    }
  };

  const priceLabel = subject
    ? isFreePrice(subject.price, subject.discountPrice)
      ? "Free"
      : formatINR(effectivePricePaise(subject.price, subject.discountPrice))
    : "";

  return (
    <div className="space-y-6">
      <Link
        to="/admin/curriculum"
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> All curriculum
      </Link>

      {subjectQ.loading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : subjectQ.error ? (
        <Alert variant="error">{subjectQ.error}</Alert>
      ) : !subject ? null : (
        <>
          <PageHeader
            title={subject.name}
            description={`${priceLabel} · ${subject.programName ?? "Unfiled"} · ${subject.enrollmentCount} enrolled`}
            actions={
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setEnrollOpen(true)}
                >
                  <UsersRound className="h-4 w-4" /> Bulk enroll students
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setRecomputeOpen(true)}
                >
                  <CalendarClock className="h-4 w-4" /> Update enrollments
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setEditingDetails(true)}
                >
                  <Pencil className="h-4 w-4" /> Edit details
                </Button>
              </div>
            }
          />

          {/* Detail summary chips */}
          <Card className="flex flex-wrap items-center gap-2 p-4">
            <Badge variant="neutral" className="font-mono">
              /{subject.slug}
            </Badge>
            {subject.isPopular ? (
              <Badge variant="info">
                <Star className="h-3 w-3" /> Popular
              </Badge>
            ) : null}
            {subject.isVisible ? (
              <Badge variant="success">
                <Eye className="h-3 w-3" /> Visible
              </Badge>
            ) : (
              <Badge variant="neutral">
                <EyeOff className="h-3 w-3" /> Hidden
              </Badge>
            )}
            {subject.discountPrice > 0 &&
            subject.discountPrice < subject.price ? (
              <span className="font-mono text-xs text-ink-muted line-through">
                {formatINR(subject.price)}
              </span>
            ) : null}
            {subject.image ? (
              <a
                href={imageUrl(subject.image)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline"
              >
                Image URL
              </a>
            ) : null}
          </Card>

          <Tabs defaultValue="modules">
            <TabsList>
              <TabsTrigger value="modules">Modules</TabsTrigger>
              <TabsTrigger value="enrollments">Enrollments</TabsTrigger>
            </TabsList>
            <TabsContent value="modules">
          {/* Modules */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
                <Layers className="h-5 w-5 text-ink-muted" /> Modules
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setBulkOpen(true)}
                >
                  <FileUp className="h-4 w-4" /> Bulk upload topics
                </Button>
                <Button size="sm" onClick={() => setModuleEditing(null)}>
                  <Plus className="h-4 w-4" /> New module
                </Button>
              </div>
            </div>

            {modulesQ.loading ? (
              <Skeleton className="h-40 w-full rounded-2xl" />
            ) : modulesQ.error ? (
              <Alert variant="error">{modulesQ.error}</Alert>
            ) : modules.length === 0 ? (
              <EmptyState
                title="No modules yet"
                description="Add a module to start structuring this course."
                icon={<Layers />}
                action={
                  <Button size="sm" onClick={() => setModuleEditing(null)}>
                    <Plus className="h-4 w-4" /> New module
                  </Button>
                }
              />
            ) : (
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Order</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Topics</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modules.map((m, i) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <IconButton
                              aria-label="Move up"
                              variant="ghost"
                              size="sm"
                              disabled={i === 0 || reordering}
                              icon={<ChevronUp className="h-4 w-4" />}
                              onClick={() => void moveModule(i, -1)}
                            />
                            <IconButton
                              aria-label="Move down"
                              variant="ghost"
                              size="sm"
                              disabled={i === modules.length - 1 || reordering}
                              icon={<ChevronDown className="h-4 w-4" />}
                              onClick={() => void moveModule(i, 1)}
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-ink">{m.name}</div>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant={openModuleId === m.id ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() =>
                              setOpenModuleId((cur) =>
                                cur === m.id ? null : m.id,
                              )
                            }
                          >
                            <ListTree className="h-4 w-4" /> Manage topics (
                            {m.topicCount})
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              aria-label="Edit module"
                              variant="ghost"
                              size="sm"
                              icon={<Pencil className="h-4 w-4" />}
                              onClick={() => setModuleEditing(m)}
                            />
                            <IconButton
                              aria-label="Delete module"
                              variant="ghost"
                              size="sm"
                              icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                              onClick={() => setModuleDeleting(m)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}

            {openModule ? (
              <ModuleTopicsPanel
                key={openModule.id}
                module={openModule}
                onClose={() => setOpenModuleId(null)}
                onChanged={() => {
                  modulesQ.refetch();
                  subjectQ.refetch();
                }}
              />
            ) : null}
          </section>
            </TabsContent>
            <TabsContent value="enrollments">
              <SubjectEnrollmentsTab subjectId={subjectId} />
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Dialogs */}
      {bulkOpen ? (
        <BulkUploadTopicsDialog
          open
          onOpenChange={setBulkOpen}
          subjectId={subjectId}
          onUploaded={() => {
            modulesQ.refetch();
            subjectQ.refetch();
          }}
        />
      ) : null}

      {enrollOpen ? (
        <BulkEnrollDialog
          open
          onOpenChange={setEnrollOpen}
          defaultSubjectId={subjectId}
          onDone={() => subjectQ.refetch()}
        />
      ) : null}

      {editingDetails && subject ? (
        <SubjectEditorDialog
          open
          onOpenChange={setEditingDetails}
          initial={subject}
          onSaved={() => subjectQ.refetch()}
        />
      ) : null}

      {subject ? (
        <Dialog open={recomputeOpen} onOpenChange={setRecomputeOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Update enrollments</DialogTitle>
              <DialogDescription>
                {subject.validityDays > 0 ? (
                  <>
                    Recompute access expiry for all {subject.enrollmentCount}{" "}
                    enrolled learner
                    {subject.enrollmentCount === 1 ? "" : "s"} to their
                    enrolment date + <strong>{subject.validityDays} days</strong>
                    . Learners already past that point lose access. This
                    overwrites any current expiry on this course.
                  </>
                ) : (
                  <>
                    This course is set to <strong>lifetime access</strong> (0
                    days). Running this clears any expiry for all{" "}
                    {subject.enrollmentCount} enrolled learner
                    {subject.enrollmentCount === 1 ? "" : "s"}, restoring
                    permanent access.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRecomputeOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                loading={recomputing}
                onClick={() => void runRecompute()}
              >
                <CalendarClock className="h-4 w-4" /> Update {subject.enrollmentCount}{" "}
                enrolment{subject.enrollmentCount === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {moduleEditing !== undefined ? (
        <ModuleEditorDialog
          key={moduleEditing?.id ?? "new"}
          open
          onOpenChange={(o) => {
            if (!o) setModuleEditing(undefined);
          }}
          subjectId={subjectId}
          initial={moduleEditing}
          nextOrder={modules.length}
          onSaved={() => {
            modulesQ.refetch();
            subjectQ.refetch();
          }}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={moduleDeleting !== null}
        onOpenChange={(o) => {
          if (!o) setModuleDeleting(null);
        }}
        title="Delete this module?"
        noun="module"
        description={
          <>This permanently deletes “{moduleDeleting?.name}”.</>
        }
        onConfirm={() =>
          api.adminCurriculum.modules.remove(moduleDeleting!.id)
        }
        onDeleted={() => {
          toast({ title: "Module deleted" });
          modulesQ.refetch();
          subjectQ.refetch();
        }}
      />
    </div>
  );
}
