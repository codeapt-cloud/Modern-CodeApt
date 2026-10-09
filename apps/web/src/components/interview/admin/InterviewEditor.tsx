/**
 * The ONE mock-interview authoring editor (Step 34) — the interview twin of
 * SpeakingAssessmentEditor. Surface-agnostic: it consumes an injected
 * InterviewAuthoringApi and toggles the platform-only course-attach picker vs the
 * college org-unit picker on `surface`. Authors set the role/seniority, the
 * question PLAN (counts + follow-up caps), the duration/attempt cap, and optional
 * fixed SEED questions.
 */
import type {
  CollegeStudent,
  MockInterviewUpsert,
  OrgUnitTreeNode,
  Role,
} from "@codeapt/shared";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { CourseTopicPicker } from "../../curriculum/CourseTopicPicker.js";
import { OrgUnitTargetPicker } from "../../colleges/exams/OrgUnitTargetPicker.js";
import { parseApiError } from "../../../lib/api-client.js";
import type { InterviewAuthoringApi } from "../../../lib/interview-authoring-api.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Textarea } from "../../ui/textarea.js";

type SeedQuestion = MockInterviewUpsert["seedQuestions"][number];

interface Draft {
  title: string;
  description: string;
  role: string;
  seniority: string;
  durationMinutes: number;
  maxAttempts: number;
  behaviouralCount: number;
  technicalCount: number;
  maxFollowUpsPerAnswer: number;
  maxFollowUpsPerSession: number;
  seedQuestions: SeedQuestion[];
  orgUnitIds: string[];
  assignedUserIds: string[];
  topicId: string;
}

const EMPTY: Draft = {
  title: "",
  description: "",
  role: "",
  seniority: "",
  durationMinutes: 20,
  maxAttempts: 1,
  behaviouralCount: 3,
  technicalCount: 4,
  maxFollowUpsPerAnswer: 1,
  maxFollowUpsPerSession: 4,
  seedQuestions: [],
  orgUnitIds: [],
  assignedUserIds: [],
  topicId: "",
};

function toUpsert(d: Draft, surface: "college" | "platform"): MockInterviewUpsert {
  return {
    title: d.title.trim(),
    description: d.description,
    role: d.role.trim(),
    seniority: d.seniority.trim(),
    durationMinutes: d.durationMinutes,
    maxAttempts: d.maxAttempts,
    plan: {
      behaviouralCount: d.behaviouralCount,
      technicalCount: d.technicalCount,
      maxFollowUpsPerAnswer: d.maxFollowUpsPerAnswer,
      maxFollowUpsPerSession: d.maxFollowUpsPerSession,
    },
    seedQuestions: d.seedQuestions,
    ...(surface === "college"
      ? { orgUnitIds: d.orgUnitIds, assignedUserIds: d.assignedUserIds }
      : {}),
    ...(surface === "platform" && d.topicId ? { topicId: d.topicId } : {}),
  };
}

/** Searchable multi-select of the college's students (individual assignment). */
function StudentAssignPicker({
  students,
  value,
  onChange,
}: {
  students: CollegeStudent[];
  value: string[];
  onChange: (ids: string[]) => void;
}): JSX.Element {
  const [q, setQ] = useState("");
  const selected = useMemo(() => new Set(value), [value]);
  const toggle = (id: string): void =>
    onChange(selected.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term
      ? students.filter(
          (s) =>
            s.fullName.toLowerCase().includes(term) ||
            s.rollNumber.toLowerCase().includes(term),
        )
      : students;
    return base.slice(0, 50);
  }, [students, q]);

  return (
    <div className="space-y-1.5">
      <Label>Assign individual students (optional)</Label>
      <p className="text-xs text-ink-muted">
        Leave both this and the cohorts empty to make the interview available to
        the whole college. Otherwise only the selected cohorts and students can take it.
      </p>
      <Input
        placeholder="Search students by name or roll number…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {value.length > 0 ? (
        <p className="text-xs text-ink-muted" data-testid="assign-count">
          {value.length} student{value.length === 1 ? "" : "s"} selected
        </p>
      ) : null}
      <div className="max-h-48 overflow-y-auto rounded-md border border-subtle">
        {filtered.length === 0 ? (
          <p className="p-3 text-sm text-ink-muted">No matching students.</p>
        ) : (
          filtered.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 border-b border-subtle px-3 py-2 text-sm last:border-b-0 hover:bg-surface-overlay"
            >
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
              />
              <span className="truncate text-ink">{s.fullName}</span>
              <span className="ml-auto shrink-0 text-xs text-ink-muted">{s.rollNumber}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 12,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
      />
    </div>
  );
}

export function InterviewEditor({
  authApi,
  surface,
  assessmentId,
  orgUnitTree = [],
  students = [],
  role,
  onSaved,
  onBack,
}: {
  authApi: InterviewAuthoringApi;
  surface: "college" | "platform";
  assessmentId: string | null;
  orgUnitTree?: OrgUnitTreeNode[];
  students?: CollegeStudent[];
  role?: Role;
  onSaved: (id: string) => void;
  onBack: () => void;
}): JSX.Element {
  const [d, setD] = useState<Draft>(EMPTY);
  const [loading, setLoading] = useState(assessmentId !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => setD((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (assessmentId === null) return;
    let live = true;
    authApi
      .get(assessmentId)
      .then((a) => {
        if (!live) return;
        setD({
          title: a.title,
          description: a.description,
          role: a.role,
          seniority: a.seniority,
          durationMinutes: a.durationMinutes,
          maxAttempts: a.maxAttempts,
          behaviouralCount: a.plan.behaviouralCount,
          technicalCount: a.plan.technicalCount,
          maxFollowUpsPerAnswer: a.plan.maxFollowUpsPerAnswer,
          maxFollowUpsPerSession: a.plan.maxFollowUpsPerSession,
          seedQuestions: a.seedQuestions,
          orgUnitIds: a.orgUnitIds,
          assignedUserIds: a.assignedUserIds,
          topicId: a.topicId,
        });
        setLoading(false);
      })
      .catch((e) => live && setError(parseApiError(e).message));
    return () => {
      live = false;
    };
  }, [assessmentId, authApi]);

  const ready = d.title.trim().length > 0 && d.role.trim().length > 0;

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const body = toUpsert(d, surface);
      const saved = assessmentId
        ? await authApi.update(assessmentId, body)
        : await authApi.create(body);
      onSaved(saved.id);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const roleValue: Role = role ?? ("student" as Role);

  if (loading) return <p className="text-ink-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">
          {assessmentId ? "Edit interview" : "New interview"}
        </h1>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
      </div>
      {error ? <Alert variant="error">{error}</Alert> : null}

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={d.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Target role</Label>
              <Input value={d.role} onChange={(e) => set("role", e.target.value)} placeholder="Backend Engineer" />
            </div>
            <div className="space-y-1.5">
              <Label>Seniority</Label>
              <Input value={d.seniority} onChange={(e) => set("seniority", e.target.value)} placeholder="mid" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={2} value={d.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField label="Duration (minutes)" value={d.durationMinutes} onChange={(n) => set("durationMinutes", n)} min={1} max={120} />
            <NumberField label="Attempts (0 = unlimited)" value={d.maxAttempts} onChange={(n) => set("maxAttempts", n)} min={0} max={20} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="font-medium text-ink">Question plan</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField label="Behavioural questions" value={d.behaviouralCount} onChange={(n) => set("behaviouralCount", n)} />
            <NumberField label="Technical questions" value={d.technicalCount} onChange={(n) => set("technicalCount", n)} />
            <NumberField label="Follow-ups per answer (max 2)" value={d.maxFollowUpsPerAnswer} onChange={(n) => set("maxFollowUpsPerAnswer", n)} max={2} />
            <NumberField label="Follow-ups per session (max 6)" value={d.maxFollowUpsPerSession} onChange={(n) => set("maxFollowUpsPerSession", n)} max={6} />
          </div>

          <div className="space-y-2">
            <Label>Fixed seed questions (optional)</Label>
            {d.seedQuestions.map((q, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={q.text}
                  onChange={(e) =>
                    set(
                      "seedQuestions",
                      d.seedQuestions.map((s, j) => (j === i ? { ...s, text: e.target.value } : s)),
                    )
                  }
                  placeholder="A fixed question every candidate is asked…"
                />
                <select
                  className="rounded-lg border border-subtle bg-surface px-2 py-2 text-sm"
                  value={q.category}
                  onChange={(e) =>
                    set(
                      "seedQuestions",
                      d.seedQuestions.map((s, j) =>
                        j === i ? { ...s, category: e.target.value as SeedQuestion["category"] } : s,
                      ),
                    )
                  }
                >
                  <option value="behavioural">behavioural</option>
                  <option value="technical">technical</option>
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => set("seedQuestions", d.seedQuestions.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                set("seedQuestions", [
                  ...d.seedQuestions,
                  { text: "", category: "behavioural", promptAudioUrl: "", promptAudioVoiceId: "", promptAudioVoiceVersion: "" },
                ])
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Add seed question
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          {surface === "platform" ? (
            authApi.listTopics ? (
              <div className="space-y-1.5">
                <Label>Attach to a curriculum topic (optional)</Label>
                <CourseTopicPicker
                  value={d.topicId}
                  onChange={(id) => set("topicId", id)}
                  load={authApi.listTopics}
                  noun="mock interview"
                />
              </div>
            ) : null
          ) : (
            <div className="space-y-4">
              <OrgUnitTargetPicker
                tree={orgUnitTree}
                value={d.orgUnitIds}
                onChange={(ids) => set("orgUnitIds", ids)}
                role={roleValue}
              />
              <StudentAssignPicker
                students={students}
                value={d.assignedUserIds}
                onChange={(ids) => set("assignedUserIds", ids)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button disabled={!ready || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
