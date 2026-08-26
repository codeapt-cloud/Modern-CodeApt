/**
 * The ONE CommunicationAssessment composite editor (S30) — extracted from the
 * former CollegeCommunicationEditorPage and made surface-agnostic via an injected
 * CommunicationAuthoringApi (the Step-8 adapter pattern). Compose parts from
 * EXISTING artifacts (exam / essay / speaking) with order, weight, and gating.
 * The college wrapper injects the tenant adapter; the platform wrapper injects the
 * college:null adapter (its part pickers list platform artifacts, matching the
 * server's generalized resolvePartRef). Never creates artifacts — only references.
 *
 * Step-23 resilience preserved verbatim: each picker list is settled
 * INDEPENDENTLY (one failing list can't blank the editor), and an existing part
 * whose picker didn't return it keeps its resolved title and is never dropped.
 */
import {
  type CommunicationAssessmentUpsert,
  type CommunicationPartType,
} from "@codeapt/shared";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { parseApiError } from "../../../lib/api-client.js";
import type { CommunicationAuthoringApi } from "../../../lib/communication-authoring-api.js";
import { settleArtifactLists } from "../../../lib/communication-editor.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Textarea } from "../../ui/textarea.js";
import { CourseTopicPicker } from "../../curriculum/CourseTopicPicker.js";

const PART_TYPE_LABEL: Record<CommunicationPartType, string> = {
  exam: "exam",
  essay: "essay",
  speaking: "speaking",
};

interface PartForm {
  partType: CommunicationPartType;
  ref: string;
  refTitle: string;
  label: string;
  weight: number;
  requiresPrevious: boolean;
  availableFrom: string;
}

interface Artifact {
  id: string;
  title: string;
  isPublished: boolean;
}

const selectCls =
  "h-10 rounded-lg border border-strong bg-surface px-3 text-sm text-ink";

function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CommunicationAssessmentEditor({
  authApi,
  surface,
  assessmentId,
  onSaved,
  onBack,
}: {
  authApi: CommunicationAuthoringApi;
  surface: "platform" | "college";
  assessmentId: string | null;
  onSaved: () => void;
  onBack: () => void;
}): JSX.Element {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [passPercentage, setPass] = useState(50);
  const [distinctionPercentage, setDistinction] = useState(60);
  const [topicId, setTopicId] = useState("");
  const [parts, setParts] = useState<PartForm[]>([]);
  const [exams, setExams] = useState<Artifact[]>([]);
  const [essays, setEssays] = useState<Artifact[]>([]);
  const [speaking, setSpeaking] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickerErrors, setPickerErrors] = useState<
    Record<CommunicationPartType, string | null>
  >({ exam: null, essay: null, speaking: null });

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    setPickerErrors({ exam: null, essay: null, speaking: null });
    try {
      const results = await Promise.allSettled([
        authApi.listExams(),
        authApi.listEssays(),
        authApi.listSpeaking(),
      ]);
      const settled = settleArtifactLists(results, (r) => parseApiError(r).message);
      setExams(settled.exams);
      setEssays(settled.essays);
      setSpeaking(settled.speaking);
      setPickerErrors(settled.pickerErrors);

      if (assessmentId) {
        const d = await authApi.get(assessmentId);
        setTitle(d.title);
        setDescription(d.description);
        setPass(d.passPercentage);
        setDistinction(d.distinctionPercentage);
        setTopicId(d.topicId ?? "");
        setParts(
          d.parts.map((p) => ({
            partType: p.partType,
            ref: p.ref,
            refTitle: p.refTitle,
            label: p.label,
            weight: p.weight,
            requiresPrevious: p.requiresPrevious,
            availableFrom: isoToLocal(p.availableFrom),
          })),
        );
      }
    } catch (err) {
      setLoadError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [authApi, assessmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const artifactsFor = (t: CommunicationPartType): Artifact[] =>
    t === "exam" ? exams : t === "essay" ? essays : speaking;

  const setPart = (i: number, patch: Partial<PartForm>): void =>
    setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addPart = (): void =>
    setParts((ps) => [
      ...ps,
      {
        partType: "exam",
        ref: "",
        refTitle: "",
        label: "",
        weight: 1,
        requiresPrevious: ps.length > 0,
        availableFrom: "",
      },
    ]);
  const removePart = (i: number): void =>
    setParts((ps) => ps.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1): void =>
    setParts((ps) => {
      const j = i + dir;
      if (j < 0 || j >= ps.length) return ps;
      const next = [...ps];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const unpublishedRefs = useMemo(() => {
    const pool = (t: CommunicationPartType): Artifact[] =>
      t === "exam" ? exams : t === "essay" ? essays : speaking;
    return parts.filter((p) => {
      const a = pool(p.partType).find((x) => x.id === p.ref);
      return a && !a.isPublished;
    }).length;
  }, [parts, exams, essays, speaking]);

  const save = async (): Promise<void> => {
    setError(null);
    if (!title.trim()) return setError("Give the assessment a title.");
    if (parts.length === 0) return setError("Add at least one part.");
    for (const p of parts) {
      if (!p.ref) return setError("Every part must reference an artifact.");
      if (!p.label.trim()) return setError("Every part needs a label.");
    }
    const body: CommunicationAssessmentUpsert = {
      title: title.trim(),
      description,
      passPercentage,
      distinctionPercentage,
      // Platform: attach to a COMMUNICATION topic ("" = platform-internal). The
      // college path ignores topicId (topic:null), so it's only sent on platform.
      ...(surface === "platform" ? { topicId: topicId.trim() } : {}),
      parts: parts.map((p) => ({
        partType: p.partType,
        ref: p.ref,
        label: p.label.trim(),
        weight: p.weight,
        requiresPrevious: p.requiresPrevious,
        availableFrom: p.availableFrom
          ? new Date(p.availableFrom).toISOString()
          : null,
      })),
    };
    setSaving(true);
    try {
      if (assessmentId) await authApi.update(assessmentId, body);
      else await authApi.create(body);
      onSaved();
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const unavailablePickers = (
    ["exam", "essay", "speaking"] as CommunicationPartType[]
  ).filter((t) => pickerErrors[t]);

  if (loading) return <Alert variant="info">Loading…</Alert>;
  if (loadError) {
    return (
      <div className="space-y-4">
        <Alert variant="error">Couldn’t load this assessment: {loadError}</Alert>
        <Button variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <button onClick={onBack} className="text-sm text-ink-muted hover:text-ink">
          ← Assessments
        </button>
        <h1 className="mt-1 text-xl font-semibold text-ink">
          {assessmentId ? "Edit" : "New"} communication assessment
        </h1>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {unavailablePickers.length > 0 && (
        <Alert variant="warning">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              {unavailablePickers.map((t) => PART_TYPE_LABEL[t]).join(", ")} parts are
              not available to pick right now
              {pickerErrors[unavailablePickers[0]!]
                ? ` (${pickerErrors[unavailablePickers[0]!]})`
                : ""}
              . You can still compose the other part types.
            </span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex gap-4">
            <div>
              <Label htmlFor="pass">Pass %</Label>
              <Input
                id="pass"
                type="number"
                value={passPercentage}
                onChange={(e) => setPass(Number(e.target.value))}
                className="w-28"
              />
            </div>
            <div>
              <Label htmlFor="dist">Distinction %</Label>
              <Input
                id="dist"
                type="number"
                value={distinctionPercentage}
                onChange={(e) => setDistinction(Number(e.target.value))}
                className="w-28"
              />
            </div>
          </div>
          {surface === "platform" && authApi.listTopics ? (
            <CourseTopicPicker
              value={topicId}
              onChange={setTopicId}
              load={authApi.listTopics}
              noun="communication assessment"
            />
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-ink">Parts (in order)</h2>
          <Button size="sm" variant="outline" onClick={addPart}>
            <Plus className="mr-1 h-4 w-4" /> Add part
          </Button>
        </div>

        {unpublishedRefs > 0 && (
          <Alert variant="warning">
            {unpublishedRefs} referenced part
            {unpublishedRefs === 1 ? " is" : "s are"} not published — publishing this
            assessment will be refused until they are.
          </Alert>
        )}

        {parts.map((p, i) => {
          const opts = artifactsFor(p.partType);
          return (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink-muted">#{i + 1}</span>
                  <select
                    className={selectCls}
                    value={p.partType}
                    onChange={(e) =>
                      setPart(i, {
                        partType: e.target.value as CommunicationPartType,
                        ref: "",
                        refTitle: "",
                      })
                    }
                  >
                    <option value="exam">Exam</option>
                    <option value="essay">Essay</option>
                    <option value="speaking">Speaking</option>
                  </select>
                  <select
                    className={`${selectCls} min-w-0 flex-1`}
                    value={p.ref}
                    disabled={!!pickerErrors[p.partType]}
                    onChange={(e) => setPart(i, { ref: e.target.value })}
                  >
                    <option value="">
                      {pickerErrors[p.partType]
                        ? `— ${p.partType} unavailable —`
                        : `— choose ${p.partType} —`}
                    </option>
                    {p.ref && !opts.some((o) => o.id === p.ref) && (
                      <option value={p.ref}>
                        {p.refTitle || "Current selection"}
                        {pickerErrors[p.partType] ? " (kept — list unavailable)" : ""}
                      </option>
                    )}
                    {opts.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                        {o.isPublished ? "" : " (draft)"}
                      </option>
                    ))}
                  </select>
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => move(i, -1)} className="p-1 text-ink-muted hover:text-ink">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button onClick={() => move(i, 1)} className="p-1 text-ink-muted hover:text-ink">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button onClick={() => removePart(i)} className="p-1 text-red-600 hover:text-red-700">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {pickerErrors[p.partType] && (
                  <p className="text-xs text-amber-600">
                    The {p.partType} list couldn’t be loaded ({pickerErrors[p.partType]}).{" "}
                    {p.ref
                      ? `This part keeps its current selection${p.refTitle ? ` (${p.refTitle})` : ""} and is saved unchanged; retry above to pick a different one.`
                      : "Switch this part to another type, or retry above."}
                  </p>
                )}
                <div className="flex flex-wrap items-end gap-4">
                  <div className="min-w-48 flex-1">
                    <Label>Label (shown to the student)</Label>
                    <Input value={p.label} onChange={(e) => setPart(i, { label: e.target.value })} />
                  </div>
                  <div>
                    <Label>Weight</Label>
                    <Input
                      type="number"
                      value={p.weight}
                      onChange={(e) => setPart(i, { weight: Number(e.target.value) })}
                      className="w-24"
                    />
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={p.requiresPrevious}
                      onChange={(e) => setPart(i, { requiresPrevious: e.target.checked })}
                    />
                    Requires previous
                  </label>
                  <div>
                    <Label>Opens (optional)</Label>
                    <Input
                      type="datetime-local"
                      value={p.availableFrom}
                      onChange={(e) => setPart(i, { availableFrom: e.target.value })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : assessmentId ? "Save changes" : "Create"}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
