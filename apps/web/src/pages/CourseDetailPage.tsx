import {
  CurriculumErrorCode,
  formatINR,
  type SubjectDetail,
  type TopicType,
} from "@codeapt/shared";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FileText,
  Lock,
  PenLine,
  PlayCircle,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { CourseThumb } from "../components/course/CourseThumb.js";
import { PriceTag } from "../components/course/PriceTag.js";
import { Alert } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";
import { Progress } from "../components/ui/progress.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { useToast } from "../components/ui/toast.js";
import { api, parseApiError } from "../lib/api-client.js";
import { useQuery } from "../lib/use-query.js";
import { useAuth } from "../providers/AuthProvider.js";

const TOPIC_META: Record<TopicType, { icon: LucideIcon; label: string }> = {
  text: { icon: FileText, label: "Article" },
  video: { icon: PlayCircle, label: "Video" },
  quiz: { icon: ClipboardList, label: "Quiz" },
  exam: { icon: ClipboardList, label: "Exam" },
  essay: { icon: PenLine, label: "Essay" },
};

export function CourseDetailPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, loading, error, refetch } = useQuery<SubjectDetail>(
    () => api.curriculum.subject(slug),
    [slug],
  );

  const [enrolling, setEnrolling] = useState(false);
  const { status } = useAuth();

  const handleEnroll = async () => {
    if (status !== "authenticated") {
      navigate(`/login?next=/courses/${slug}`);
      return;
    }

    setEnrolling(true);
    try {
      const res = await api.curriculum.enroll(slug);
      toast({
        variant: "success",
        title:
          res.result === "ENROLLED" ? "You're enrolled!" : "Already enrolled",
      });
      refetch();
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.code === CurriculumErrorCode.PAYMENT_REQUIRED) {
        // Paid course — route to checkout (price known up-front from catalog).
        navigate(`/checkout/${slug}`);
      } else {
        toast({
          variant: "error",
          title: "Could not enrol",
          description: parsed.message,
        });
      }
    } finally {
      setEnrolling(false);
    }
  };

  if (loading) return <CourseDetailSkeleton />;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink />
        <Alert variant="error" title="Course not found">
          {error ?? "This course does not exist or is unavailable."}
        </Alert>
      </div>
    );
  }

  const enrolled = data.enrollment.isEnrolled;

  return (
    <div className="space-y-8">
      <BackLink />

      {/* Hero */}
      <Card className="overflow-hidden">
        <div className="grid gap-6 md:grid-cols-[1fr_320px]">
          <div className="space-y-4 p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2">
              {data.program ? (
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                  {data.program.name}
                </span>
              ) : null}
              {data.isPopular ? (
                <Badge variant="primary">
                  <Sparkles className="h-3 w-3" /> Popular
                </Badge>
              ) : null}
              {enrolled ? (
                <Badge variant="success">
                  <CheckCircle2 className="h-3 w-3" /> Enrolled
                </Badge>
              ) : null}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-ink">
              {data.name}
            </h1>
            <p className="max-w-2xl text-ink-secondary">{data.description}</p>
            <div className="flex flex-wrap gap-4 text-sm text-ink-muted">
              <span>{data.moduleCount} modules</span>
              <span>{data.topicCount} topics</span>
            </div>

            {enrolled ? (
              <div className="max-w-md space-y-2 pt-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-secondary">Your progress</span>
                  <span className="font-mono text-ink">
                    {data.progress.percentage}%
                  </span>
                </div>
                <Progress value={data.progress.percentage} />
                <p className="text-xs text-ink-muted">
                  {data.progress.completedTopics} of {data.progress.totalTopics}{" "}
                  topics complete
                </p>
              </div>
            ) : null}
          </div>

          {/* CTA panel */}
          <div className="flex flex-col justify-between gap-4 border-t border-subtle bg-surface-base p-6 md:border-l md:border-t-0 md:p-8">
            <CourseThumb name={data.name} image={data.image} className="h-28 w-full rounded-xl" />
            <div className="space-y-4">
              <PriceTag
                price={data.price}
                discountPrice={data.discountPrice}
                effectivePrice={data.effectivePrice}
                isFree={data.isFree}
                className="text-lg"
              />
              {enrolled ? (
                <Button asChild className="w-full" size="lg">
                  <Link to={`/learn/${data.slug}`}>
                    {data.progress.percentage > 0
                      ? "Continue learning"
                      : "Start learning"}
                  </Link>
                </Button>
              ) : data.isFree ? (
                <Button
                  className="w-full"
                  size="lg"
                  loading={enrolling}
                  onClick={handleEnroll}
                >
                  Enrol for free
                </Button>
              ) : (
                <Button asChild className="w-full" size="lg">
                  <Link to={`/checkout/${data.slug}`}>
                    Buy — {formatINR(data.effectivePrice)}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Outline */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <span className="font-mono text-primary" aria-hidden="true">
              {"{"}
            </span>
            Course content
            <span className="font-mono text-primary" aria-hidden="true">
              {"}"}
            </span>
          </h2>
          {data.modules.map((module, mi) => (
            <Card key={module.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  <span className="mr-2 font-mono text-ink-muted">
                    {String(mi + 1).padStart(2, "0")}
                  </span>
                  {module.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="divide-y divide-subtle">
                  {module.topics.map((topic) => {
                    const meta = TOPIC_META[topic.topicType];
                    const Icon = meta.icon;
                    return (
                      <li
                        key={topic.id}
                        className="flex items-center gap-3 py-3 text-sm"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-ink-muted" />
                        <span className="flex-1 text-ink">{topic.name}</span>
                        <span className="text-xs text-ink-muted">
                          {meta.label}
                        </span>
                        {topic.duration ? (
                          <span className="w-16 text-right text-xs text-ink-muted">
                            {topic.duration}
                          </span>
                        ) : null}
                        {topic.isCompleted ? (
                          <CheckCircle2 className="h-4 w-4 text-success-fg" />
                        ) : topic.isLocked ? (
                          <Lock className="h-4 w-4 text-ink-muted" />
                        ) : (
                          <span className="h-4 w-4" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What’s included</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0 text-sm text-ink-secondary">
              <Included label={`${data.moduleCount} modules`} />
              <Included label={`${data.topicCount} lessons`} />
              <Included label="Articles, videos & quizzes" />
              <Included label="Progress tracking" />
              <Included label="Lifetime access" />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Included({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className="h-4 w-4 text-primary" />
      {label}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/courses"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-primary"
    >
      <ArrowLeft className="h-4 w-4" /> All courses
    </Link>
  );
}

function CourseDetailSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-4 w-24" />
      <Card className="p-8">
        <div className="space-y-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Card>
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  );
}
