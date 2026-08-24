/**
 * Communication composite AUTHORING editor (Step 21). Compose an assessment from
 * EXISTING college artifacts — pick an exam / essay / speaking assessment per
 * part, set its order, weight, and gating (requires-previous + an optional open
 * date). One editor for the college surface (a platform surface would inject a
 * different data source, the established pattern). It never creates exams/essays/
 * speaking — it only references them; the composite reads their scores later.
 */
import {
  CollegeFeature,
  checkEntitlement,
  type CommunicationAssessmentUpsert,
  type CommunicationPartType,
} from "@codeapt/shared";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { Textarea } from "../../components/ui/textarea.js";
import { api } from "../../lib/api-client.js";
import { useCollege } from "./college-context.js";

interface PartForm {
  partType: CommunicationPartType;
  ref: string;
  label: string;
  weight: number;
  requiresPrevious: boolean;
  availableFrom: string; // datetime-local value ("" = none)
}

interface Artifact {
  id: string;
  title: string;
  isPublished: boolean;
}

const selectCls =
  "h-10 rounded-lg border border-strong bg-surface px-3 text-sm text-ink";

/** ISO → the value a <input type=datetime-local> expects (local, no seconds). */
function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CollegeCommunicationEditorPage() {
  const { slug, context } = useCollege();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editingId = params.get("id");
  const canAuthor = checkEntitlement(
    context.entitlements,
    CollegeFeature.COMMUNICATION,
    "authoring",
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [passPercentage, setPass] = useState(50);
  const [distinctionPercentage, setDistinction] = useState(60);
  const [parts, setParts] = useState<PartForm[]>([]);
  const [exams, setExams] = useState<Artifact[]>([]);
  const [essays, setEssays] = useState<Artifact[]>([]);
  const [speaking, setSpeaking] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canAuthor) return;
    void (async () => {
      const [ex, es, sp] = await Promise.all([
        api.collegeExams.list(slug),
        api.collegeEssayTopics.list(slug),
        api.collegeSpeaking.list(slug),
      ]);
      setExams(ex.items.map((x) => ({ id: x.id, title: x.title, isPublished: x.isPublished })));
      setEssays(es.items.map((x) => ({ id: x.id, title: x.title, isPublished: x.isPublished })));
      setSpeaking(sp.items.map((x) => ({ id: x.id, title: x.title, isPublished: x.isPublished })));
      if (editingId) {
        const d = await api.collegeCommunication.get(slug, editingId);
        setTitle(d.title);
        setDescription(d.description);
        setPass(d.passPercentage);
        setDistinction(d.distinctionPercentage);
        setParts(
          d.parts.map((p) => ({
            partType: p.partType,
            ref: p.ref,
            label: p.label,
            weight: p.weight,
            requiresPrevious: p.requiresPrevious,
            availableFrom: isoToLocal(p.availableFrom),
          })),
        );
      }
      setLoading(false);
    })();
  }, [slug, canAuthor, editingId]);

  const artifactsFor = (t: CommunicationPartType): Artifact[] =>
    t === "exam" ? exams : t === "essay" ? essays : speaking;

  const setPart = (i: number, patch: Partial<PartForm>): void =>
    setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addPart = (): void =>
    setParts((ps) => [
      ...ps,
      { partType: "exam", ref: "", label: "", weight: 1, requiresPrevious: ps.length > 0, availableFrom: "" },
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
      if (editingId) await api.collegeCommunication.update(slug, editingId, body);
      else await api.collegeCommunication.create(slug, body);
      navigate(`/c/${slug}/communication/assessments`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (!canAuthor) {
    return <Alert variant="info">You don’t have communication authoring access.</Alert>;
  }
  if (loading) return <Alert variant="info">Loading…</Alert>;

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => navigate(`/c/${slug}/communication/assessments`)}
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← Assessments
        </button>
        <h1 className="mt-1 text-xl font-semibold text-ink">
          {editingId ? "Edit" : "New"} communication assessment
        </h1>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

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
            {unpublishedRefs === 1 ? " is" : "s are"} not published — publishing
            this assessment will be refused until they are.
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
                    onChange={(e) => setPart(i, { ref: e.target.value })}
                  >
                    <option value="">— choose {p.partType} —</option>
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
          {saving ? "Saving…" : editingId ? "Save changes" : "Create"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => navigate(`/c/${slug}/communication/assessments`)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default CollegeCommunicationEditorPage;
