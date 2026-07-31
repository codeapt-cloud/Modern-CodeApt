/**
 * College courses (route: /c/:slug/courses). Lists the courses the super-admin
 * GRANTED to this college with their current assignment counts; each can be
 * assigned to (in-scope) students via the AssignStudentsDialog. Students then
 * learn assigned courses through the EXISTING course player (no forked UI) — they
 * appear on the student's normal dashboard via their enrollments.
 *
 * Gated by the `courses` feature (the nav entry is hidden otherwise; this page
 * also shows a clear note and the backend 403s). Mirrors the other college pages.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { BookOpen, Users } from "lucide-react";
import { useState } from "react";

import { AssignStudentsDialog } from "../../components/colleges/AssignStudentsDialog.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeCoursesPage() {
  const { slug, context } = useCollege();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.COURSES,
  );

  const coursesQuery = useQuery(
    () => (entitled ? api.collegeCourses.list(slug) : Promise.resolve({ items: [] })),
    [slug, entitled],
  );
  const treeQuery = useQuery(
    () => api.collegeOrgUnits.listTree(slug),
    [slug],
  );
  const tree = treeQuery.data?.items ?? [];
  const courses = coursesQuery.data?.items ?? [];

  const [assigning, setAssigning] = useState<{ id: string; name: string } | null>(
    null,
  );

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Courses"
          description="Assign granted courses to your students."
        />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <BookOpen className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">
            Courses aren&apos;t enabled
          </h2>
          <p className="text-sm text-ink-muted">
            This feature isn&apos;t turned on for your college. Contact your
            CodeApt administrator to enable it.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Courses"
        description="Assign the courses granted to your college to your students. They'll learn them through the course player."
      />

      {coursesQuery.loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : coursesQuery.error ? (
        <Alert variant="error">{coursesQuery.error}</Alert>
      ) : courses.length === 0 ? (
        <EmptyState
          title="No courses granted yet"
          description="Your CodeApt administrator hasn't granted any courses to your college. Once they do, they'll appear here to assign."
          icon={<BookOpen />}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {courses.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-ink">{c.name}</h3>
                  <p className="font-mono text-[11px] text-ink-muted">
                    {c.slug}
                  </p>
                </div>
                <Badge variant="neutral">
                  <Users className="h-3.5 w-3.5" /> {c.assignedCount}
                </Badge>
              </div>
              {c.description ? (
                <p className="line-clamp-2 text-sm text-ink-muted">
                  {c.description}
                </p>
              ) : null}
              <div className="mt-auto pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setAssigning({ id: c.id, name: c.name })}
                >
                  <Users className="h-4 w-4" /> Assign students
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {assigning ? (
        <AssignStudentsDialog
          open
          onOpenChange={(o) => {
            if (!o) setAssigning(null);
          }}
          slug={slug}
          course={assigning}
          tree={tree}
          onChanged={() => coursesQuery.refetch()}
        />
      ) : null}
    </div>
  );
}
