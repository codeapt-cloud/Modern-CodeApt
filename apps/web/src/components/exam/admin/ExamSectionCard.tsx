/**
 * One authored section rendered as a card: its header (order / name / timing /
 * question count / description) with add-question + edit + delete actions, then
 * its questions with type-adaptive detail — MCQ options (correct answers
 * highlighted) and CODE starter-code + the inline TestCaseEditor.
 *
 * Extracted verbatim from AdminExamEditorPage so BOTH the platform-admin and the
 * college exam editors render sections identically. The only seam is `authApi`
 * (forwarded to the TestCaseEditor) — it defaults to the platform admin api, so
 * the admin editor is unchanged; the college editor injects a tenant adapter.
 */
import type { AdminExamDetail } from "@codeapt/shared";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Layers,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { api } from "../../../lib/api-client.js";
import {
  codeLanguageLabel,
  isCode,
  questionTypeLabel,
} from "../../../lib/exam-authoring.js";
import type { ExamAuthoringApi } from "../../../lib/exam-authoring-api.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card } from "../../ui/card.js";
import { IconButton } from "../../ui/icon-button.js";
import { TestCaseEditor } from "./TestCaseEditor.js";

type Section = AdminExamDetail["sections"][number];
type Question = Section["questions"][number];

const LETTERS = ["A", "B", "C", "D", "E"];

export function ExamSectionCard({
  section,
  onAddQuestion,
  onEditSection,
  onEditQuestion,
  onDeleteSection,
  onDeleteQuestion,
  onRequestDeleteTestCase,
  onChanged,
  authApi = api.adminExams,
  headerActions,
}: {
  section: Section;
  onAddQuestion: () => void;
  onEditSection: () => void;
  onEditQuestion: (q: Question) => void;
  onDeleteSection: () => void;
  onDeleteQuestion: (q: Question) => void;
  onRequestDeleteTestCase: (id: string) => void;
  onChanged: () => void;
  /** Authoring backend — defaults to the platform admin api; the college editor
   * injects a slug-bound tenant adapter (forwarded to the TestCaseEditor). */
  authApi?: ExamAuthoringApi;
  /** Extra add-question actions (e.g. the college bank pickers), rendered next to
   * the "Question" button. Omitted on the admin editor → unchanged there. */
  headerActions?: React.ReactNode;
}) {
  // Collapsible so a long exam is scannable — presentation-only local state,
  // default expanded. Collapsing hides the questions well, keeping the header
  // (with its count) as the container summary.
  const [expanded, setExpanded] = useState(true);
  const bodyId = `section-${section.id}-questions`;

  return (
    // A section reads as a CONTAINER: a colored left spine down the whole card,
    // a tinted header band with a "Section" pill, and its questions nested inside
    // a sunken well as individual raised tiles (obvious even with one question).
    <Card className="overflow-hidden border-l-4 border-l-primary/60">
      <div className="flex items-start justify-between gap-4 border-b border-subtle bg-primary/[0.06] p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <IconButton
              aria-label={expanded ? "Collapse section" : "Expand section"}
              aria-expanded={expanded}
              aria-controls={bodyId}
              variant="ghost"
              size="sm"
              icon={
                <ChevronRight
                  className={
                    "h-4 w-4 transition-transform " + (expanded ? "rotate-90" : "")
                  }
                />
              }
              onClick={() => setExpanded((e) => !e)}
            />
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              <Layers className="h-3 w-3" /> Section
            </span>
            <Badge variant="neutral">#{section.order}</Badge>
            <h3 className="text-base font-semibold text-ink">{section.name}</h3>
          </div>
          <p className="mt-1 flex items-center gap-3 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {section.durationMinutes} min
            </span>
            <span>
              {section.questions.length} question
              {section.questions.length === 1 ? "" : "s"}
            </span>
          </p>
          {section.description ? (
            <p className="mt-1 text-sm text-ink-secondary">
              {section.description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={onAddQuestion}>
            <Plus className="h-4 w-4" /> Question
          </Button>
          {headerActions}
          <IconButton
            aria-label="Edit section"
            variant="ghost"
            size="sm"
            icon={<Pencil className="h-4 w-4" />}
            onClick={onEditSection}
          />
          <IconButton
            aria-label="Delete section"
            variant="ghost"
            size="sm"
            icon={<Trash2 className="h-4 w-4 text-error-fg" />}
            onClick={onDeleteSection}
          />
        </div>
      </div>

      {!expanded ? null : section.questions.length === 0 ? (
        <div id={bodyId} className="bg-surface-sunken p-3 sm:p-4">
          <p className="rounded-xl border border-dashed border-subtle p-6 text-center text-sm text-ink-muted">
            No questions in this section yet — add one with the actions above.
          </p>
        </div>
      ) : (
        <ul
          id={bodyId}
          className="space-y-3 bg-surface-sunken p-3 sm:p-4"
          aria-label={`Questions in ${section.name}`}
        >
          {section.questions.map((q, i) => (
            <li
              key={q.id}
              className="space-y-3 rounded-xl border border-subtle bg-surface-raised p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-muted">
                      Q{i + 1}
                    </span>
                    <Badge variant="info">{questionTypeLabel(q.type)}</Badge>
                    <span className="text-xs text-ink-muted">
                      {q.marks} marks
                    </span>
                    {isCode(q.type) ? (
                      <Badge variant="neutral">
                        {codeLanguageLabel(q.language)}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-line text-sm text-ink">
                    {q.text}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    aria-label="Edit question"
                    variant="ghost"
                    size="sm"
                    icon={<Pencil className="h-4 w-4" />}
                    onClick={() => onEditQuestion(q)}
                  />
                  <IconButton
                    aria-label="Delete question"
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                    onClick={() => onDeleteQuestion(q)}
                  />
                </div>
              </div>

              {/* MCQ options with the correct answer(s) highlighted */}
              {q.options && q.options.length > 0 ? (
                <ul className="grid gap-1.5">
                  {q.options.map((opt, oi) => {
                    const correct = q.correctOptions?.includes(oi) ?? false;
                    return (
                      <li
                        key={oi}
                        className={
                          "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm " +
                          (correct
                            ? "border-success/40 bg-success-subtle text-ink"
                            : "border-subtle text-ink-secondary")
                        }
                      >
                        <span className="font-mono text-xs text-ink-muted">
                          {LETTERS[oi] ?? oi + 1}
                        </span>
                        <span className="flex-1">{opt}</span>
                        {correct ? (
                          <CheckCircle2 className="h-4 w-4 text-success-fg" />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {/* CODE: starter code + test cases */}
              {isCode(q.type) ? (
                <div className="space-y-3">
                  {q.starterCode ? (
                    <pre className="overflow-x-auto rounded-xl border border-subtle bg-surface-sunken p-3 font-mono text-xs text-ink-secondary">
                      {q.starterCode}
                    </pre>
                  ) : null}
                  <TestCaseEditor
                    questionId={q.id}
                    testCases={q.testCases}
                    onChanged={onChanged}
                    onRequestDelete={onRequestDeleteTestCase}
                    authApi={authApi}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
