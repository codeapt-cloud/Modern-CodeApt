import type { TopicContent } from "@codeapt/shared";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  PenLine,
} from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/api-client.js";
import { getAdjacent, type FlatTopic } from "../../lib/player.js";
import { useQuery } from "../../lib/use-query.js";
import { EssayStatusCard } from "../essay/EssayStatusCard.js";
import { ExamStatusCard } from "../exam/ExamStatusCard.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Skeleton } from "../ui/skeleton.js";
import { Markdown } from "./Markdown.js";
import { QuizRunner } from "./QuizRunner.js";
import { VideoEmbed } from "./VideoEmbed.js";

const TYPE_LABEL: Record<string, string> = {
  text: "Article",
  video: "Video",
  quiz: "Quiz",
  exam: "Exam",
  essay: "Essay",
};

export function TopicPane({
  slug,
  flat,
  current,
  completed,
  loadTopic,
  onNavigate,
  onToggleComplete,
  onFinish,
}: {
  slug: string;
  flat: FlatTopic[];
  current: FlatTopic;
  completed: Record<string, boolean>;
  loadTopic: (topicId: string) => Promise<TopicContent>;
  onNavigate: (topicId: string) => void;
  onToggleComplete: (topicId: string, next: boolean) => Promise<void>;
  onFinish: () => void;
}) {
  const reduced = useReducedMotion();
  const topicId = current.topic.id;
  const { prev, next } = getAdjacent(flat, topicId);

  const {
    data: content,
    loading,
    error,
  } = useQuery(() => loadTopic(topicId), [topicId]);

  const [quizGraded, setQuizGraded] = useState(false);
  const [togglingComplete, setTogglingComplete] = useState(false);

  const isCompleted = completed[topicId] ?? current.topic.isCompleted;
  const isQuiz = current.topic.topicType === "quiz";
  const canComplete = !isQuiz || quizGraded || isCompleted;

  const handleToggle = async () => {
    setTogglingComplete(true);
    try {
      await onToggleComplete(topicId, !isCompleted);
    } finally {
      setTogglingComplete(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      {/* Topic header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge variant="neutral">
          {TYPE_LABEL[current.topic.topicType] ?? current.topic.topicType}
        </Badge>
        <span className="text-xs uppercase tracking-wide text-ink-muted">
          {current.moduleName}
        </span>
        {current.topic.duration ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
            <Clock className="h-3.5 w-3.5" /> {current.topic.duration}
          </span>
        ) : null}
      </div>
      <h1 className="mb-8 text-2xl font-bold tracking-tight text-ink">
        {current.topic.name}
      </h1>

      {/* Body */}
      <motion.div
        key={topicId}
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
      >
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : error || !content ? (
          <Alert variant="error">{error ?? "Failed to load this topic."}</Alert>
        ) : content.topicType === "text" ? (
          <Markdown content={content.content} />
        ) : content.topicType === "video" ? (
          <VideoEmbed videoId={content.videoId} title={content.name} />
        ) : content.topicType === "quiz" ? (
          <QuizRunner
            slug={slug}
            topicId={topicId}
            onGraded={() => setQuizGraded(true)}
          />
        ) : content.topicType === "exam" ? (
          <ExamTopicLauncher topicId={topicId} />
        ) : content.topicType === "essay" ? (
          <EssayTopicLauncher topicId={topicId} />
        ) : (
          <PlaceholderTopic />
        )}
      </motion.div>

      {/* Completion toggle */}
      <div className="mt-10 flex items-center justify-between border-t border-subtle pt-6">
        <Button
          variant={isCompleted ? "secondary" : "primary"}
          loading={togglingComplete}
          disabled={!canComplete}
          onClick={handleToggle}
        >
          {isCompleted ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Completed
            </>
          ) : (
            <>
              <Circle className="h-4 w-4" /> Mark as complete
            </>
          )}
        </Button>
        {isQuiz && !quizGraded && !isCompleted ? (
          <span className="text-xs text-ink-muted">
            Submit the quiz to mark this complete
          </span>
        ) : null}
      </div>

      {/* Prev / Next */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          disabled={!prev}
          onClick={() => prev && onNavigate(prev.topic.id)}
        >
          <ArrowLeft className="h-4 w-4" /> Previous
        </Button>
        {next ? (
          <Button variant="outline" onClick={() => onNavigate(next.topic.id)}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={onFinish}>
            Finish course <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * In-course exam entry point. Reuses the SAME status source as the Mock Exams
 * page (GET /exams via `api.exams.list()`), matching the exam whose `topicId`
 * is this topic, and renders the shared <ExamStatusCard> — so "Start exam"
 * (→ the existing /exam/:examId runner) and "Attempt limit reached" behave
 * identically here and on /exams. No exam/attempt logic is duplicated.
 */
function ExamTopicLauncher({ topicId }: { topicId: string }) {
  const { data, loading, error } = useQuery(() => api.exams.list(), []);
  const item = data?.items.find((e) => e.topicId === topicId);

  if (loading) {
    return <Skeleton className="h-56 w-full rounded-2xl" />;
  }
  if (error || !item) {
    return (
      <Alert variant="info">
        {error ??
          "This exam isn’t available to you yet. It appears once it’s published for your subject."}
      </Alert>
    );
  }
  return <ExamStatusCard item={item} />;
}

/**
 * In-course essay entry point. Reuses the SAME status source as the Essays page
 * (GET /essays via `api.essays.list()`), matching the essay whose `topicId` is
 * this curriculum topic, and renders the shared <EssayStatusCard> — so "Write
 * essay"/"Write again" (→ the existing /essays/:essayTopicId writer) and
 * "Attempt limit reached" behave identically here and on /essays. No essay,
 * attempt-cap, or composer logic is duplicated. If no linked/accessible essay
 * resolves (data gap or not enrolled), it degrades gracefully to a message.
 */
function EssayTopicLauncher({ topicId }: { topicId: string }) {
  const { data, loading, error } = useQuery(() => api.essays.list(), []);
  const item = data?.items.find((e) => e.topicId === topicId);

  if (loading) {
    return <Skeleton className="h-56 w-full rounded-2xl" />;
  }
  if (error || !item) {
    return (
      <Alert variant="info">
        {error ??
          "This essay isn’t available to you yet. It appears once the prompt is linked and published for your subject."}
      </Alert>
    );
  }
  return <EssayStatusCard item={item} />;
}

function PlaceholderTopic() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-strong bg-surface-base px-6 py-14 text-center">
      <div className="flex items-center gap-2 font-mono text-3xl text-primary/60">
        <span>{"{"}</span>
        <PenLine className="h-6 w-6 text-ink-muted" />
        <span>{"}"}</span>
      </div>
      <h3 className="text-base font-semibold text-ink">Content coming soon</h3>
      <p className="max-w-sm text-sm text-ink-muted">
        This topic type doesn’t have a viewer yet.
      </p>
    </div>
  );
}
