/**
 * Exam status + launch card. Renders an exam's name, marks, section/question
 * counts, duration, pass %, and the attempt line, plus the action button:
 * "Start exam"/"Retake" → the existing runner at /exam/:examId, or a disabled
 * "Attempt limit reached". Shared by the Mock Exams page and the in-course exam
 * topic so both surface the same feature identically. All state comes from the
 * `ExamListItem` (GET /exams) — no attempt/limit logic lives here.
 */
import type { ExamListItem } from "@codeapt/shared";
import { Clock, FileCheck2, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";

import { examAttempted, examCanStart } from "../../lib/exam-status.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";

export function ExamStatusCard({
  item,
  collegeSlug,
}: {
  item: ExamListItem;
  /** When set, this is a COLLEGE exam → the runner starts via the tenant
   * endpoint (passed through as `?c=<slug>`). Omitted for individual exams, so
   * the individual take flow is unchanged. */
  collegeSlug?: string;
}) {
  const canStart = examCanStart(item);
  const attempted = examAttempted(item);
  const href = collegeSlug
    ? `/exam/${item.id}?c=${encodeURIComponent(collegeSlug)}`
    : `/exam/${item.id}`;

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-ink">{item.title}</h3>
          <Badge variant="neutral">{item.totalMarks} marks</Badge>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="h-3.5 w-3.5" /> {item.sectionCount} sections
            · {item.questionCount} questions
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {item.totalDurationMinutes} min
          </span>
          <span className="inline-flex items-center gap-1">
            <FileCheck2 className="h-3.5 w-3.5" /> pass {item.passPercentage}%
          </span>
        </div>

        {item.lastAttempt ? (
          <div className="rounded-lg border border-subtle bg-surface-base p-3 text-xs">
            <span className="text-ink-muted">Last attempt: </span>
            <span className="text-ink">{item.lastAttempt.status}</span>
            {item.lastAttempt.status === "graded" ? (
              <>
                {" · "}
                <span
                  className={
                    item.lastAttempt.passed ? "text-success-fg" : "text-error-fg"
                  }
                >
                  {item.lastAttempt.score}/{item.totalMarks}{" "}
                  {item.lastAttempt.passed ? "PASS" : "FAIL"}
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3">
          <span className="text-xs text-ink-muted">
            {item.attemptsUsed}/{item.maxAttempts} attempts used
          </span>
          {canStart ? (
            <Button asChild size="sm">
              <Link to={href}>{attempted ? "Retake" : "Start exam"}</Link>
            </Button>
          ) : (
            <Button size="sm" disabled title="No attempts remaining">
              Attempt limit reached
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
