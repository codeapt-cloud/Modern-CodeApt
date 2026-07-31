/**
 * My courses (student space, route: /c/:slug/courses for a student). Lists the
 * courses the college ASSIGNED to this student (GET /c/:slug/student/courses,
 * tenant-scoped + source=college), reusing the same course card + progress and
 * opening the EXISTING course player at /learn/:slug — carrying `?c=<slug>` so
 * the player's back-nav returns to this student space. Entitlement-gated on
 * `courses`. Individual (B2C) courses are never shown here.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { BookOpen } from "lucide-react";
import { Link } from "react-router-dom";

import { CourseThumb } from "../../components/course/CourseThumb.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Stagger, StaggerItem } from "../../components/motion/index.js";
import { Alert } from "../../components/ui/alert.js";
import { Card } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Progress } from "../../components/ui/progress.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeStudentCoursesPage() {
  const { slug, context } = useCollege();
  const enabled = checkEntitlement(context.entitlements, CollegeFeature.COURSES);

  const query = useQuery(
    () => (enabled ? api.collegeContext.studentCourses(slug) : Promise.resolve({ items: [] })),
    [slug, enabled],
  );
  const items = query.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My courses"
        description="Courses assigned to you by your college. Open one to keep learning."
      />

      {!enabled ? (
        <Alert variant="info">
          Courses aren&apos;t enabled for your college yet.
        </Alert>
      ) : query.loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="h-24 w-full rounded-none" />
              <div className="space-y-3 p-5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-2 w-full" />
              </div>
            </Card>
          ))}
        </div>
      ) : query.error ? (
        <Alert variant="error">{query.error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No courses assigned yet"
          description="When your college assigns you a course, it appears here."
          icon={<BookOpen />}
        />
      ) : (
        <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <StaggerItem key={item.subject.id} className="h-full">
              <Link
                to={`/learn/${item.subject.slug}?c=${encodeURIComponent(slug)}`}
                className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:shadow-focus"
              >
                <Card className="flex h-full flex-col overflow-hidden transition-all duration-base group-hover:-translate-y-0.5 group-hover:shadow-glow">
                  <CourseThumb
                    name={item.subject.name}
                    image={item.subject.image}
                    className="h-24 w-full"
                  />
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    {item.subject.program ? (
                      <span className="text-xs font-medium uppercase tracking-wide text-primary">
                        {item.subject.program.name}
                      </span>
                    ) : null}
                    <h3 className="font-semibold text-ink">
                      {item.subject.name}
                    </h3>
                    <div className="mt-auto space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-ink-muted">
                          {item.progress.completedTopics}/
                          {item.progress.totalTopics} topics
                        </span>
                        <span className="font-mono text-ink">
                          {item.progress.percentage}%
                        </span>
                      </div>
                      <Progress value={item.progress.percentage} />
                    </div>
                  </div>
                </Card>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
