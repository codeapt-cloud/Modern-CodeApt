/**
 * Type-adaptive Topic editor. The visible fields switch on topicType, mirroring
 * the exam QuestionEditorDialog's type-switch:
 *   - text  → content (markdown)
 *   - video → videoId (YouTube id) + duration
 *   - quiz  → name only (questions are authored in the quiz sub-editor)
 *   - exam  → name only (the backend auto-creates the linked Exam shell)
 *   - essay → optional essayTopic link (no prompt-list endpoint yet → info note)
 *
 * topicType is IMMUTABLE on edit (the backend rejects a change), so the type
 * selector shows only on create; on edit the type is a fixed badge.
 */
import {
  TOPIC_TYPE_VALUES,
  TopicType,
  type AdminTopic,
  type AdminTopicUpsert,
} from "@codeapt/shared";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { topicTypeLabel } from "../../../lib/curriculum-admin-ui.js";
import { useQuery } from "../../../lib/use-query.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { FormField } from "../../ui/form-field.js";
import { Input } from "../../ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";
import { useToast } from "../../ui/toast.js";

interface TopicDraft {
  topicType: TopicType;
  name: string;
  content: string;
  videoId: string;
  duration: string;
  isVisible: boolean;
  /** "" = no essay prompt linked (essay type only). */
  essayTopicId: string;
}

/** Radix Select forbids an empty item value; "no prompt" gets a token. */
const NO_PROMPT = "__none__";

function toDraft(topic: AdminTopic | null): TopicDraft {
  return {
    topicType: (topic?.topicType as TopicType) ?? TopicType.TEXT,
    name: topic?.name ?? "",
    content: topic?.content ?? "",
    videoId: topic?.videoId ?? "",
    duration: topic?.duration ?? "",
    isVisible: topic?.isVisible ?? true,
    essayTopicId: topic?.essayTopicId ?? "",
  };
}

function toPayload(d: TopicDraft): AdminTopicUpsert {
  const base = { name: d.name.trim(), isVisible: d.isVisible };
  switch (d.topicType) {
    case TopicType.TEXT:
      return { topicType: TopicType.TEXT, ...base, content: d.content };
    case TopicType.VIDEO:
      return {
        topicType: TopicType.VIDEO,
        ...base,
        videoId: d.videoId.trim(),
        duration: d.duration.trim(),
      };
    case TopicType.QUIZ:
      return { topicType: TopicType.QUIZ, ...base };
    case TopicType.EXAM:
      return { topicType: TopicType.EXAM, ...base };
    case TopicType.GAME:
      return { topicType: TopicType.GAME, ...base };
    case TopicType.SPEAKING:
      // Bare like GAME — the SpeakingAssessment is authored + attached separately
      // (platform create with topicId). Full authoring UI is Step 30. (S29)
      return { topicType: TopicType.SPEAKING, ...base };
    case TopicType.COMMUNICATION:
      return { topicType: TopicType.COMMUNICATION, ...base };
    case TopicType.ESSAY:
      // Picker-driven link (nullable) — a real EssayTopic or none.
      return {
        topicType: TopicType.ESSAY,
        ...base,
        essayTopicId: d.essayTopicId ? d.essayTopicId : null,
      };
  }
}

export interface TopicEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleId: string;
  /** null → create; an AdminTopic → edit (type is then fixed). */
  initial: AdminTopic | null;
  onSaved: (topic: AdminTopic) => void;
}

export function TopicEditorDialog({
  open,
  onOpenChange,
  moduleId,
  initial,
  onSaved,
}: TopicEditorDialogProps) {
  const { toast } = useToast();
  const isEdit = initial !== null;
  const [draft, setDraft] = useState<TopicDraft>(() => toDraft(initial));
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Essay prompts feed the essay-type picker (only fetched for essay topics).
  const { data: essayTopicsData } = useQuery(
    () =>
      draft.topicType === TopicType.ESSAY
        ? api.adminEssayTopics.list()
        : Promise.resolve({ items: [] }),
    [draft.topicType],
  );
  const essayTopics = essayTopicsData?.items ?? [];

  const patch = (next: Partial<TopicDraft>): void =>
    setDraft((d) => ({ ...d, ...next }));

  const submit = async (): Promise<void> => {
    setFormError("");
    setSubmitting(true);
    try {
      const payload = toPayload(draft);
      const saved = isEdit
        ? await api.adminCurriculum.topics.update(initial.id, payload)
        : await api.adminCurriculum.topics.create(moduleId, payload);
      toast({
        variant: "success",
        title: isEdit
          ? "Topic updated"
          : saved.topicType === TopicType.EXAM
            ? "Exam topic created — open it from the exam editor"
            : "Topic created",
      });
      onOpenChange(false);
      onSaved(saved);
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const t = draft.topicType;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit topic" : "New topic"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "A topic's type is fixed after creation."
              : "Pick a type — the form adapts to it."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <FormField label="Type">
            {isEdit ? (
              <div>
                <Badge variant="info">{topicTypeLabel(t)}</Badge>
              </div>
            ) : (
              <Select
                value={t}
                onValueChange={(v) => patch({ topicType: v as TopicType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOPIC_TYPE_VALUES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {topicTypeLabel(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label="Name" required>
            <Input
              value={draft.name}
              placeholder="Introduction to arrays"
              onChange={(e) => patch({ name: e.target.value })}
            />
          </FormField>

          {t === TopicType.TEXT ? (
            <FormField label="Content" hint="Markdown supported.">
              <Textarea
                rows={6}
                value={draft.content}
                onChange={(e) => patch({ content: e.target.value })}
              />
            </FormField>
          ) : null}

          {t === TopicType.VIDEO ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="YouTube video id" hint="The id, not the URL.">
                <Input
                  value={draft.videoId}
                  placeholder="dQw4w9WgXcQ"
                  onChange={(e) => patch({ videoId: e.target.value })}
                />
              </FormField>
              <FormField label="Duration" hint="A label, e.g. “8 min”.">
                <Input
                  value={draft.duration}
                  placeholder="8 min"
                  onChange={(e) => patch({ duration: e.target.value })}
                />
              </FormField>
            </div>
          ) : null}

          {t === TopicType.QUIZ ? (
            <Alert variant="info">
              After creating the topic, use “Questions” on its row to author the
              quiz (each question needs ≥2 choices and ≥1 correct).
            </Alert>
          ) : null}

          {t === TopicType.EXAM ? (
            <Alert variant="info">
              Creating an exam topic auto-creates its linked exam. Configure its
              sections and questions from the exam editor
              {isEdit && initial?.examId ? (
                <>
                  {" "}
                  (
                  <a
                    href={`/admin/exams/${initial.examId}`}
                    className="text-primary hover:underline"
                  >
                    open this exam
                  </a>
                  )
                </>
              ) : null}
              .
            </Alert>
          ) : null}

          {t === TopicType.ESSAY ? (
            <FormField
              label="Essay prompt"
              hint="Link a prompt authored under “Manage essay prompts” (optional)."
            >
              {essayTopics.length === 0 ? (
                <Alert variant="info">
                  No essay prompts yet. Create one under “Manage essay prompts”,
                  then link it here.
                </Alert>
              ) : (
                <Select
                  value={draft.essayTopicId ? draft.essayTopicId : NO_PROMPT}
                  onValueChange={(v) =>
                    patch({ essayTopicId: v === NO_PROMPT ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROMPT}>No prompt linked</SelectItem>
                    {essayTopics.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title}
                        {p.isActive ? "" : " (inactive)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          ) : null}

          <label className="flex items-center gap-3">
            <Switch
              checked={draft.isVisible}
              onCheckedChange={(c) => patch({ isVisible: c })}
            />
            <span className="text-sm text-ink">Visible to enrolled students</span>
          </label>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            loading={submitting}
            disabled={draft.name.trim() === ""}
            onClick={() => void submit()}
          >
            {isEdit ? "Save changes" : "Create topic"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
