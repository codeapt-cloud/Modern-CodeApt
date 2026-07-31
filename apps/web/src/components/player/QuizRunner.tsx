/**
 * Quiz-taking flow inside the player. All questions are multi-select
 * (checkboxes) — the server grades set-equality either way, so single-answer
 * questions work correctly too. Correct answers are only known AFTER submit
 * (from the QuizResult payload) and are never fetched with the quiz.
 */
import type { QuizResult } from "@codeapt/shared";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { api, parseApiError } from "../../lib/api-client.js";
import { cn } from "../../lib/cn.js";
import { getChoiceOutcome, type ChoiceOutcome } from "../../lib/player.js";
import { useQuery } from "../../lib/use-query.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Checkbox } from "../ui/checkbox.js";
import { Skeleton } from "../ui/skeleton.js";

const OUTCOME_STYLE: Record<ChoiceOutcome, string> = {
  correct: "border-success/50 bg-success-subtle",
  missed: "border-success/50 bg-success-subtle/60",
  wrong: "border-error/50 bg-error-subtle",
  neutral: "border-subtle",
};

export function QuizRunner({
  slug,
  topicId,
  onGraded,
}: {
  slug: string;
  topicId: string;
  onGraded: (result: QuizResult) => void;
}) {
  const {
    data: quiz,
    loading,
    error,
  } = useQuery(() => api.curriculum.quiz(slug, topicId), [slug, topicId]);

  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const resultByQuestion = useMemo(() => {
    const map = new Map<string, QuizResult["results"][number]>();
    result?.results.forEach((r) => map.set(r.questionId, r));
    return map;
  }, [result]);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (error || !quiz) {
    return <Alert variant="error">{error ?? "Failed to load quiz."}</Alert>;
  }

  const toggle = (questionId: string, choiceId: string) => {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      return {
        ...prev,
        [questionId]: current.includes(choiceId)
          ? current.filter((id) => id !== choiceId)
          : [...current, choiceId],
      };
    });
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const graded = await api.curriculum.submitQuiz(slug, topicId, {
        answers: quiz.questions.map((q) => ({
          questionId: q.id,
          choiceIds: answers[q.id] ?? [],
        })),
      });
      setResult(graded);
      onGraded(graded);
    } catch (err) {
      setSubmitError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const retake = () => {
    setAnswers({});
    setResult(null);
    setSubmitError("");
  };

  const graded = result !== null;

  return (
    <div className="space-y-6">
      {graded ? (
        <Card className="border-primary/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <p className="text-sm text-ink-muted">Your score</p>
              <p className="font-mono text-3xl font-bold text-ink">
                {result.score}
                <span className="text-lg text-ink-muted">
                  /{result.maxScore}
                </span>
              </p>
            </div>
            <div className="text-center">
              <p className="font-mono text-3xl font-bold text-primary">
                {result.percentage}%
              </p>
              <p className="text-sm text-ink-muted">
                {result.correctCount}/{result.totalQuestions} correct
              </p>
            </div>
            <Button variant="outline" onClick={retake}>
              <RotateCcw className="h-4 w-4" /> Retake
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {quiz.questions.map((question, qi) => {
        const qResult = resultByQuestion.get(question.id);
        const selected = answers[question.id] ?? [];
        return (
          <Card key={question.id}>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium text-ink">
                  <span className="mr-2 font-mono text-ink-muted">
                    Q{qi + 1}.
                  </span>
                  {question.text}
                </h3>
                {graded && qResult ? (
                  qResult.correct ? (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3 w-3" /> Correct
                    </Badge>
                  ) : (
                    <Badge variant="error">
                      <XCircle className="h-3 w-3" /> Incorrect
                    </Badge>
                  )
                ) : null}
              </div>

              <div className="space-y-2">
                {question.choices.map((choice) => {
                  const outcome = qResult
                    ? getChoiceOutcome(
                        choice.id,
                        qResult.selectedChoiceIds,
                        qResult.correctChoiceIds,
                      )
                    : "neutral";
                  return (
                    <label
                      key={choice.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors",
                        graded
                          ? OUTCOME_STYLE[outcome]
                          : "border-subtle hover:border-primary/50",
                      )}
                    >
                      <Checkbox
                        checked={
                          graded
                            ? qResult?.selectedChoiceIds.includes(choice.id)
                            : selected.includes(choice.id)
                        }
                        disabled={graded}
                        onCheckedChange={() => toggle(question.id, choice.id)}
                      />
                      <span className="flex-1 text-ink">{choice.text}</span>
                      {graded && outcome === "missed" ? (
                        <span className="text-xs font-medium text-success-fg">
                          Correct answer
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {submitError ? <Alert variant="error">{submitError}</Alert> : null}

      {!graded ? (
        <Button size="lg" loading={submitting} onClick={submit}>
          Submit quiz
        </Button>
      ) : null}
    </div>
  );
}
