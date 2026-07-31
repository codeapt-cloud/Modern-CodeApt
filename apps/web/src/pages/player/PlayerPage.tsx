/**
 * In-course learning player. Distraction-reduced layout (its own chrome, not
 * the AppShell): a persistent topic sidebar + a content pane. Deep-linkable at
 * /learn/:slug/:topicId; /learn/:slug resumes at the first incomplete topic.
 * Enrollment is enforced by the API; non-enrolled users are redirected to the
 * course detail page.
 */
import type { SubjectDetail, TopicContent } from "@codeapt/shared";
import { List, PartyPopper, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { Logo } from "../../components/brand/Logo.js";
import { PlayerSidebar } from "../../components/player/PlayerSidebar.js";
import { TopicPane } from "../../components/player/TopicPane.js";
import { Button } from "../../components/ui/button.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { Progress } from "../../components/ui/progress.js";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../../components/ui/sheet.js";
import { Spinner } from "../../components/ui/spinner.js";
import { useToast } from "../../components/ui/toast.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { flattenTopics, firstIncompleteTopicId } from "../../lib/player.js";
import { useQuery } from "../../lib/use-query.js";

export function PlayerPage() {
  const { slug = "", topicId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  // A college student opens a course with `?c=<slug>`: content access is
  // enrollment-based (unchanged), but exit/back-nav returns to their college
  // space, and the seam is preserved across topic navigation. No `?c` → the
  // individual player, byte-for-byte unchanged.
  const [searchParams] = useSearchParams();
  const collegeSlug = searchParams.get("c");
  const cq = collegeSlug ? `?c=${encodeURIComponent(collegeSlug)}` : "";
  const coursesHome = collegeSlug
    ? `/c/${encodeURIComponent(collegeSlug)}/courses`
    : "/courses";
  // College students have no B2C course-detail page → send "back to course" to
  // their My courses list; individual users keep the course detail page.
  const courseExit = collegeSlug ? coursesHome : `/courses/${slug}`;
  const homeHref = collegeSlug
    ? `/c/${encodeURIComponent(collegeSlug)}/home`
    : "/app";

  const { data, loading, error } = useQuery<SubjectDetail>(
    () => api.curriculum.subject(slug),
    [slug],
  );

  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [percentage, setPercentage] = useState(0);
  const [finished, setFinished] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const seededRef = useRef<string | null>(null);

  // Per-session content cache so back/forward between topics is instant.
  const cacheRef = useRef(new Map<string, TopicContent>());
  const loadTopic = useCallback(
    async (id: string): Promise<TopicContent> => {
      const cached = cacheRef.current.get(id);
      if (cached) return cached;
      const content = await api.curriculum.topic(slug, id);
      cacheRef.current.set(id, content);
      return content;
    },
    [slug],
  );

  // Seed completion + progress from the outline once.
  useEffect(() => {
    if (data && seededRef.current !== data.id) {
      const map: Record<string, boolean> = {};
      data.modules.forEach((m) =>
        m.topics.forEach((t) => {
          map[t.id] = t.isCompleted;
        }),
      );
      setCompleted(map);
      setPercentage(data.progress.percentage);
      seededRef.current = data.id;
    }
  }, [data]);

  const flat = useMemo(() => (data ? flattenTopics(data.modules) : []), [data]);

  const goTo = useCallback(
    (id: string) => {
      setMobileNavOpen(false);
      navigate(`/learn/${slug}/${id}${cq}`);
    },
    [navigate, slug, cq],
  );

  const toggleComplete = useCallback(
    async (id: string, next: boolean) => {
      setCompleted((prev) => ({ ...prev, [id]: next })); // optimistic
      try {
        const res = await api.curriculum.completeTopic(slug, id, next);
        setCompleted((prev) => ({ ...prev, [id]: res.isCompleted }));
        setPercentage(res.progress.percentage);
        const cached = cacheRef.current.get(id);
        if (cached) {
          cacheRef.current.set(id, {
            ...cached,
            isCompleted: res.isCompleted,
          });
        }
      } catch (err) {
        setCompleted((prev) => ({ ...prev, [id]: !next })); // revert
        toast({
          variant: "error",
          title: "Could not update progress",
          description: parseApiError(err).message,
        });
      }
    },
    [slug, toast],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Spinner size="lg" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-4 text-center">
        <p className="font-mono text-2xl text-primary">{"{ }"}</p>
        <p className="text-ink">{error ?? "Course not found."}</p>
        <Button asChild>
          <Link to={coursesHome}>Back to courses</Link>
        </Button>
      </div>
    );
  }

  // Enrollment is required to consume content.
  if (!data.enrollment.isEnrolled) {
    return <Navigate to={`/courses/${slug}`} replace />;
  }

  // Resume/default topic when none (or an invalid one) is in the URL.
  const resumeId = firstIncompleteTopicId(flat, completed);
  const current = flat.find((f) => f.topic.id === topicId);
  if (!current) {
    if (resumeId)
      return <Navigate to={`/learn/${slug}/${resumeId}${cq}`} replace />;
    // No topics at all.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-4 text-center">
        <p className="text-ink">This course has no content yet.</p>
        <Button asChild>
          <Link to={courseExit}>Back to course</Link>
        </Button>
      </div>
    );
  }

  const sidebar = (
    <PlayerSidebar
      modules={data.modules}
      currentTopicId={current.topic.id}
      completed={completed}
      percentage={percentage}
      onSelect={goTo}
    />
  );

  return (
    <div className="min-h-screen bg-surface">
      {/* Player top bar */}
      <header className="sticky top-0 z-sticky flex h-14 items-center justify-between gap-3 border-b border-subtle bg-surface-raised/80 px-3 backdrop-blur sm:px-5">
        <div className="flex items-center gap-3">
          <IconButton
            aria-label="Exit player"
            variant="ghost"
            size="sm"
            icon={<X className="h-5 w-5" />}
            onClick={() => navigate(courseExit)}
          />
          <Link
            to={homeHref}
            aria-label="CodeApt home"
            className="hidden sm:block"
          >
            <Logo className="h-6" />
          </Link>
          <span className="hidden text-sm font-medium text-ink md:block">
            {data.name}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden w-40 items-center gap-2 sm:flex">
            <Progress value={percentage} />
            <span className="font-mono text-xs text-ink-muted">
              {percentage}%
            </span>
          </div>
          {/* Mobile contents trigger */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="lg:hidden">
                <List className="h-4 w-4" /> Contents
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0">
              <SheetHeader className="p-4">
                <SheetTitle>{data.name}</SheetTitle>
              </SheetHeader>
              {sidebar}
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[320px_1fr]">
        {/* Desktop sidebar */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] border-r border-subtle bg-surface-raised lg:block">
          {sidebar}
        </aside>

        {/* Content */}
        <main>
          {finished ? (
            <CourseComplete
              courseExit={courseExit}
              homeHref={homeHref}
              percentage={percentage}
            />
          ) : (
            <TopicPane
              slug={slug}
              flat={flat}
              current={current}
              completed={completed}
              loadTopic={loadTopic}
              onNavigate={goTo}
              onToggleComplete={toggleComplete}
              onFinish={() => setFinished(true)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function CourseComplete({
  courseExit,
  homeHref,
  percentage,
}: {
  courseExit: string;
  homeHref: string;
  percentage: number;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-20 text-center">
      <div className="flex items-center gap-3 font-mono text-4xl text-primary">
        <span>{"{"}</span>
        <PartyPopper className="h-9 w-9" />
        <span>{"}"}</span>
      </div>
      <h1 className="text-2xl font-bold text-ink">You’ve reached the end!</h1>
      <p className="max-w-sm text-ink-muted">
        You’ve gone through all the content in this course. You’re at{" "}
        <span className="font-mono text-ink">{percentage}%</span> completion.
      </p>
      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link to={courseExit}>Back to course</Link>
        </Button>
        <Button asChild>
          <Link to={homeHref}>Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
