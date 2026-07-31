/**
 * Essay-prompt (EssayTopic) create/edit dialog. Covers the model's fields plus
 * a MANUAL keyword editor (chips) — the keywords feed the grader's relevance
 * dimension. AI keyword generation is intentionally shown DISABLED: the essay-AI
 * integration is grading-only (mock by default) with no keyword-generation path,
 * so it is flagged as awaiting that integration rather than faked.
 */
import {
  EssayDifficulty,
  type AdminEssayTopic,
  type EssayDifficulty as EssayDifficultyT,
  type OrgUnitTreeNode,
  type Role,
} from "@codeapt/shared";
import { Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import {
  type EssayAuthoringApi,
  type EssayAuthoringBody,
} from "../../../lib/essay-authoring-api.js";
import { canTarget } from "../../../lib/exam-targeting.js";
import { OrgUnitTargetPicker } from "../../colleges/exams/OrgUnitTargetPicker.js";
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
import { IconButton } from "../../ui/icon-button.js";
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

const DIFFICULTY_LABEL: Record<EssayDifficultyT, string> = {
  [EssayDifficulty.EASY]: "Easy",
  [EssayDifficulty.MEDIUM]: "Medium",
  [EssayDifficulty.HARD]: "Hard",
};

interface EssayTopicDraft {
  title: string;
  description: string;
  instructions: string;
  difficultyLevel: EssayDifficultyT;
  minWords: number;
  maxWords: number;
  timeLimitMinutes: number;
  maxAttempts: number;
  isActive: boolean;
  keywords: string[];
  orgUnitIds: string[];
}

function toDraft(
  t: AdminEssayTopic | null,
  initialOrgUnitIds: string[],
): EssayTopicDraft {
  return {
    title: t?.title ?? "",
    description: t?.description ?? "",
    instructions: t?.instructions ?? "",
    difficultyLevel: (t?.difficultyLevel ?? EssayDifficulty.EASY) as EssayDifficultyT,
    minWords: t?.minWords ?? 0,
    maxWords: t?.maxWords ?? 0,
    timeLimitMinutes: t?.timeLimitMinutes ?? 0,
    maxAttempts: t?.maxAttempts ?? 3,
    isActive: t?.isActive ?? true,
    keywords: t?.semanticKeywords ?? [],
    orgUnitIds: initialOrgUnitIds,
  };
}

/** College targeting mode — supplied only by the college surface. */
export interface EssayTargeting {
  tree: OrgUnitTreeNode[];
  role: Role;
  /** The topic's current target units (empty = college-wide). */
  initialOrgUnitIds: string[];
}

export interface EssayTopicEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; an AdminEssayTopic → edit. */
  initial: AdminEssayTopic | null;
  onSaved: () => void;
  /** Authoring backend — defaults to the platform admin api; the college editor
   * injects a slug-bound tenant adapter. */
  authApi?: EssayAuthoringApi;
  /** When set, renders org-unit targeting and includes orgUnitIds in the payload
   * (college mode). Omitted for the platform admin (no targeting). */
  targeting?: EssayTargeting;
}

export function EssayTopicEditorDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
  authApi = api.adminEssayTopics,
  targeting,
}: EssayTopicEditorDialogProps) {
  const { toast } = useToast();
  const isEdit = initial !== null;
  const isAdminRole =
    targeting?.role === "college_admin" || targeting?.role === "super_admin";
  const [draft, setDraft] = useState<EssayTopicDraft>(() =>
    toDraft(initial, targeting?.initialOrgUnitIds ?? []),
  );
  const [keywordInput, setKeywordInput] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genNote, setGenNote] = useState("");

  const patch = (next: Partial<EssayTopicDraft>): void =>
    setDraft((d) => ({ ...d, ...next }));

  /**
   * Propose keywords via the LLM-assisted endpoint (deterministic fallback on
   * the server). ADVISORY: it replaces the field with a proposal the admin then
   * edits and saves — nothing is auto-saved. Never blocks manual entry.
   */
  const handleGenerate = async (): Promise<void> => {
    if (draft.title.trim() === "") return;
    setGenerating(true);
    setGenNote("");
    try {
      const res = await authApi.generateKeywords({
        title: draft.title.trim(),
        description: draft.description,
        instructions: draft.instructions,
      });
      patch({ keywords: res.keywords });
      if (res.source === "deterministic") {
        setGenNote(
          "AI unavailable — generated basic keywords from the prompt. Please review and edit before saving.",
        );
      } else {
        toast({
          variant: "success",
          title: `Proposed ${res.keywords.length} keyword${res.keywords.length === 1 ? "" : "s"}`,
        });
      }
    } catch (err) {
      setGenNote(parseApiError(err).message);
    } finally {
      setGenerating(false);
    }
  };

  const addKeyword = (): void => {
    const k = keywordInput.trim();
    if (!k) return;
    if (draft.keywords.some((x) => x.toLowerCase() === k.toLowerCase())) {
      setKeywordInput("");
      return;
    }
    patch({ keywords: [...draft.keywords, k] });
    setKeywordInput("");
  };
  const removeKeyword = (k: string): void =>
    patch({ keywords: draft.keywords.filter((x) => x !== k) });

  const submit = async (): Promise<void> => {
    setFormError("");
    setSubmitting(true);
    const payload: EssayAuthoringBody = {
      title: draft.title.trim(),
      description: draft.description,
      instructions: draft.instructions,
      difficultyLevel: draft.difficultyLevel,
      minWords: Math.max(0, Math.trunc(draft.minWords) || 0),
      maxWords: Math.max(0, Math.trunc(draft.maxWords) || 0),
      timeLimitMinutes: Math.max(0, Math.trunc(draft.timeLimitMinutes) || 0),
      maxAttempts: Math.max(1, Math.trunc(draft.maxAttempts) || 1),
      isActive: draft.isActive,
      semanticKeywords: draft.keywords,
      // Org-unit targeting is included only in college mode (targeting present).
      ...(targeting ? { orgUnitIds: draft.orgUnitIds } : {}),
    };
    try {
      if (isEdit) {
        await authApi.update(initial.id, payload);
      } else {
        await authApi.create(payload);
      }
      toast({
        variant: "success",
        title: isEdit ? "Essay prompt updated" : "Essay prompt created",
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setFormError(parseApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit essay prompt" : "New essay prompt"}
          </DialogTitle>
          <DialogDescription>
            The prompt students answer; keywords feed the grader’s relevance
            score.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <FormField label="Title" required>
            <Input
              value={draft.title}
              placeholder="Argue for or against remote work"
              onChange={(e) => patch({ title: e.target.value })}
            />
          </FormField>

          <FormField label="Description" hint="Shown to students. Markdown ok.">
            <Textarea
              rows={3}
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </FormField>

          <FormField label="Instructions" hint="Guidance / rubric notes.">
            <Textarea
              rows={2}
              value={draft.instructions}
              onChange={(e) => patch({ instructions: e.target.value })}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-4">
            <FormField label="Difficulty">
              <Select
                value={String(draft.difficultyLevel)}
                onValueChange={(v) =>
                  patch({ difficultyLevel: Number(v) as EssayDifficultyT })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(EssayDifficulty).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {DIFFICULTY_LABEL[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Min words">
              <Input
                type="number"
                min={0}
                value={String(draft.minWords)}
                onChange={(e) =>
                  patch({ minWords: Math.trunc(Number(e.target.value)) || 0 })
                }
              />
            </FormField>
            <FormField label="Max words" hint="0 = no cap.">
              <Input
                type="number"
                min={0}
                value={String(draft.maxWords)}
                onChange={(e) =>
                  patch({ maxWords: Math.trunc(Number(e.target.value)) || 0 })
                }
              />
            </FormField>
            <FormField label="Time (min)" hint="0 = untimed.">
              <Input
                type="number"
                min={0}
                value={String(draft.timeLimitMinutes)}
                onChange={(e) =>
                  patch({
                    timeLimitMinutes: Math.trunc(Number(e.target.value)) || 0,
                  })
                }
              />
            </FormField>
            <FormField label="Max attempts" hint="Submissions allowed (min 1).">
              <Input
                type="number"
                min={1}
                value={String(draft.maxAttempts)}
                onChange={(e) =>
                  patch({
                    maxAttempts: Math.max(
                      1,
                      Math.trunc(Number(e.target.value)) || 1,
                    ),
                  })
                }
              />
            </FormField>
          </div>

          <FormField
            label="Relevance keywords"
            hint="Reference terms the grader checks for. Add manually."
          >
            <div className="flex gap-2">
              <Input
                value={keywordInput}
                placeholder="e.g. productivity"
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={addKeyword}>
                <Plus className="h-4 w-4" /> Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                loading={generating}
                disabled={draft.title.trim() === "" || generating}
                onClick={() => void handleGenerate()}
                title="Propose keywords from the title, description, and instructions"
              >
                <Sparkles className="h-4 w-4" /> Generate with AI
              </Button>
            </div>
            {genNote ? (
              <p className="mt-1 text-xs text-warning-fg">{genNote}</p>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">
                Proposed keywords are editable — review and adjust before saving.
                Manual entry works with or without generating.
              </p>
            )}
            {draft.keywords.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {draft.keywords.map((k) => (
                  <Badge key={k} variant="neutral" className="gap-1">
                    {k}
                    <IconButton
                      aria-label={`Remove ${k}`}
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4"
                      icon={<X className="h-3 w-3" />}
                      onClick={() => removeKeyword(k)}
                    />
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">No keywords yet.</p>
            )}
          </FormField>

          {targeting ? (
            <FormField
              label="Target cohorts"
              hint={
                isAdminRole
                  ? "Leave empty for the whole college, or pick specific sections."
                  : "Pick the section(s) this essay is for (within your scope)."
              }
            >
              <OrgUnitTargetPicker
                tree={targeting.tree}
                value={draft.orgUnitIds}
                onChange={(ids) => patch({ orgUnitIds: ids })}
                role={targeting.role}
              />
            </FormField>
          ) : null}

          <label className="flex items-center gap-3">
            <Switch
              checked={draft.isActive}
              onCheckedChange={(c) => patch({ isActive: c })}
            />
            <span className="text-sm text-ink">
              Active (available to students)
            </span>
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
            disabled={
              draft.title.trim() === "" ||
              (targeting ? !canTarget(draft.orgUnitIds, isAdminRole) : false)
            }
            onClick={() => void submit()}
          >
            {isEdit ? "Save changes" : "Create prompt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
