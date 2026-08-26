/**
 * The Speaking assessment editor — ONE editor, both surfaces via the injected
 * `SpeakingAuthoringApi` adapter (Step-8 pattern; see GameSetEditor). It composes
 * an assessment from the eleven item types, seeds from a company PRESET (CTS /
 * Accenture / Versant 2024 / SVAR) as a starting point, configures each item
 * (reference text, answer sets, key facts, prep + response windows, play limits),
 * and attaches prompt audio by UPLOAD (TTS is not API-callable — see the report;
 * never browser SpeechSynthesis, which would give every student a different voice).
 */
import {
  SPEAKING_ITEM_TYPE_VALUES,
  SPEAKING_PRESETS,
  SPEAKING_PRESET_KEYS,
  SpeakingItemType,
  buildItemsFromPreset,
  speakingItemNeedsAudio,
  speakingPromptAudioText,
  type OrgUnitTreeNode,
  type Role,
  type SpeakingItemType as SpeakingItemTypeName,
  type SpeakingItemUpsert,
  type SpeakingTtsResponse,
} from "@codeapt/shared";
import { useEffect, useState } from "react";

import { parseApiError } from "../../../lib/api-client.js";
import type { SpeakingAuthoringApi } from "../../../lib/speaking-authoring-api.js";
import { CourseTopicPicker } from "../../curriculum/CourseTopicPicker.js";
import { OrgUnitTargetPicker } from "../../colleges/exams/OrgUnitTargetPicker.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";

const REFERENCE_TYPES: readonly SpeakingItemTypeName[] = [
  "read_aloud", "repeat", "sentence_build", "error_correct", "fill_missing_word", "dictation",
];
const ANSWER_TYPES: readonly SpeakingItemTypeName[] = [
  "short_answer", "conversation", "passage_question",
];

function blankItem(): SpeakingItemUpsert {
  return {
    itemType: SpeakingItemType.READ_ALOUD,
    referenceText: "",
    promptText: "",
    promptAudioText: "",
    promptAudioUrl: "",
    promptAudioVoiceId: "",
    promptAudioVoiceVersion: "",
    stimulusAudioUrl: "",
    stimulusText: "",
    stimulusAudioVoiceId: "",
    stimulusAudioVoiceVersion: "",
    stimulusPlayLimit: 0,
    answerSet: [],
    missingWord: "",
    keyFacts: [],
    chunks: [],
    section: "",
    prepSeconds: 0,
    responseWindowSeconds: 60,
  };
}

/** PresetItemSpec → a full item (schema defaults fill the gaps). */
function fromPreset(spec: ReturnType<typeof buildItemsFromPreset>[number]): SpeakingItemUpsert {
  return {
    ...blankItem(),
    ...spec,
    answerSet: spec.answerSet ? [...spec.answerSet] : [],
    keyFacts: spec.keyFacts ? [...spec.keyFacts] : [],
    chunks: spec.chunks ? [...spec.chunks] : [],
  };
}

const linesToArray = (s: string): string[] =>
  s.split("\n").map((x) => x.trim()).filter(Boolean);

interface Draft {
  title: string;
  description: string;
  maxAttempts: number;
  orgUnitIds: string[];
  /** Platform course-attach (S30): the SPEAKING topic id, "" = platform-internal. */
  topicId: string;
  items: SpeakingItemUpsert[];
}

export function SpeakingAssessmentEditor({
  authApi,
  surface,
  assessmentId,
  orgUnitTree,
  role,
  onSaved,
  onBack,
}: {
  authApi: SpeakingAuthoringApi;
  surface: "platform" | "college";
  assessmentId: string | null;
  orgUnitTree?: OrgUnitTreeNode[];
  role?: Role;
  onSaved: (id: string) => void;
  onBack: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Draft>({
    title: "",
    description: "",
    maxAttempts: 1,
    orgUnitIds: [],
    topicId: "",
    items: [],
  });
  const [presetKey, setPresetKey] = useState<string>("cts");
  const [loading, setLoading] = useState(assessmentId !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(assessmentId);

  useEffect(() => {
    if (!assessmentId) return;
    let live = true;
    void authApi
      .get(assessmentId)
      .then((d) => {
        if (!live) return;
        setDraft({
          title: d.title,
          description: d.description,
          maxAttempts: d.maxAttempts,
          orgUnitIds: d.orgUnitIds,
          topicId: d.topicId ?? "",
          items: d.items.map((it) => ({ ...blankItem(), ...it })),
        });
        setPublished(d.isPublished);
      })
      .catch((e) => setError(parseApiError(e).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [assessmentId, authApi]);

  const patchItem = (i: number, patch: Partial<SpeakingItemUpsert>): void =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((it, k) => (k === i ? { ...it, ...patch } : it)),
    }));

  const loadPreset = (): void => {
    const preset = SPEAKING_PRESETS[presetKey];
    if (!preset) return;
    setDraft((d) => ({
      ...d,
      title: d.title || preset.name,
      description: d.description || preset.description,
      items: buildItemsFromPreset(presetKey).map(fromPreset),
    }));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: draft.title,
        description: draft.description,
        maxAttempts: draft.maxAttempts,
        items: draft.items,
        ...(surface === "college"
          ? { orgUnitIds: draft.orgUnitIds }
          : { topicId: draft.topicId.trim() }),
      };
      const saved = savedId
        ? await authApi.update(savedId, body)
        : await authApi.create(body);
      setSavedId(saved.id);
      setPublished(saved.isPublished);
      onSaved(saved.id);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (): Promise<void> => {
    if (!savedId) return;
    setSaving(true);
    try {
      const d = await authApi.setPublished(savedId, !published);
      setPublished(d.isPublished);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-ink-muted">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">
          {savedId ? "Edit speaking assessment" : "New speaking assessment"}
        </h2>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      {/* Preset starting point. */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label>Start from a preset</Label>
            <select
              className="rounded-lg border border-subtle bg-surface px-3 py-2 text-ink"
              value={presetKey}
              onChange={(e) => setPresetKey(e.target.value)}
            >
              {SPEAKING_PRESET_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SPEAKING_PRESETS[k]?.name ?? k}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" onClick={loadPreset}>
            Load preset items
          </Button>
          <span className="text-xs text-ink-muted">
            Replaces the item list with the preset&apos;s composition; edit freely
            afterwards.
          </span>
        </CardContent>
      </Card>

      {/* Assessment-level fields. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Title</Label>
          <Input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Max attempts (0 = unlimited)</Label>
          <Input
            type="number"
            min={0}
            value={draft.maxAttempts}
            onChange={(e) =>
              setDraft((d) => ({ ...d, maxAttempts: Number(e.target.value) }))
            }
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Description</Label>
          <Input
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
        </div>
      </div>

      {surface === "college" && orgUnitTree && role ? (
        <div className="space-y-1">
          <Label>Target cohorts (empty = whole college)</Label>
          <OrgUnitTargetPicker
            tree={orgUnitTree}
            value={draft.orgUnitIds}
            onChange={(ids) => setDraft((d) => ({ ...d, orgUnitIds: ids }))}
            role={role}
          />
        </div>
      ) : null}

      {/* Platform surface: attach to a SPEAKING curriculum topic (course-attached). */}
      {surface === "platform" && authApi.listTopics ? (
        <CourseTopicPicker
          value={draft.topicId}
          onChange={(topicId) => setDraft((d) => ({ ...d, topicId }))}
          load={authApi.listTopics}
          noun="speaking assessment"
        />
      ) : null}

      {/* Items. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-ink">Items ({draft.items.length})</h3>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }))
            }
          >
            Add item
          </Button>
        </div>
        {draft.items.map((it, i) => (
          <ItemForm
            key={i}
            index={i}
            item={it}
            uploadPromptAudio={authApi.uploadPromptAudio}
            generatePromptAudio={authApi.generatePromptAudio}
            onChange={(patch) => patchItem(i, patch)}
            onRemove={() =>
              setDraft((d) => ({
                ...d,
                items: d.items.filter((_, k) => k !== i),
              }))
            }
            onMove={(dir) =>
              setDraft((d) => {
                const items = [...d.items];
                const j = i + dir;
                if (j < 0 || j >= items.length) return d;
                [items[i], items[j]] = [items[j]!, items[i]!];
                return { ...d, items };
              })
            }
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        {savedId ? (
          <Button variant="secondary" disabled={saving} onClick={() => void togglePublish()}>
            {published ? "Unpublish" : "Publish"}
          </Button>
        ) : null}
        <Button disabled={saving || !draft.title.trim()} onClick={() => void save()}>
          {saving ? "Saving…" : savedId ? "Save changes" : "Create"}
        </Button>
      </div>
    </div>
  );
}

function ItemForm({
  index,
  item,
  uploadPromptAudio,
  generatePromptAudio,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  item: SpeakingItemUpsert;
  uploadPromptAudio: (file: File) => Promise<string>;
  generatePromptAudio: (text: string) => Promise<SpeakingTtsResponse>;
  onChange: (patch: Partial<SpeakingItemUpsert>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}): JSX.Element {
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const needsReference = REFERENCE_TYPES.includes(item.itemType);
  const needsAnswerSet = ANSWER_TYPES.includes(item.itemType);
  const isDictation = item.itemType === SpeakingItemType.DICTATION;

  const onPickAudio = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadPromptAudio(file);
      // A manual upload has no voice on record (provenance is TTS-only).
      onChange({ promptAudioUrl: url, promptAudioVoiceId: "", promptAudioVoiceVersion: "" });
    } finally {
      setUploading(false);
    }
  };

  // Does THIS item play a spoken prompt at all? read_aloud / open_topic show
  // their text on screen — synthesising a clip for them is meaningless (it was
  // the bug: a read_aloud with a 4s clip of its own reference sentence). Gate
  // the whole control on the shared predicate the runner + publish guard obey.
  const needsAudio = speakingItemNeedsAudio({ itemType: item.itemType, chunks: item.chunks });
  // The EXACT text the prompt clip will say — the on-screen prompt/instruction
  // (or the scrambled chunks for sentence_build), derived by the shared helper so
  // the preview below and the seed generate identical audio. It NEVER speaks the
  // reference text (that is the answer key, used only for verification).
  const ttsText = speakingPromptAudioText({
    itemType: item.itemType,
    promptText: item.promptText,
    promptAudioText: item.promptAudioText,
    chunks: item.chunks,
  });
  // The text used when the author has NOT overridden it — shown as the textarea's
  // placeholder so they can see the default and choose to replace it.
  const ttsDefaultText = speakingPromptAudioText({
    itemType: item.itemType,
    promptText: item.promptText,
    chunks: item.chunks,
  });
  const ttsSourceLabel =
    item.itemType === SpeakingItemType.SENTENCE_BUILD
      ? "the scrambled chunks (in order)"
      : "the prompt / instruction";
  const onGenerate = async (): Promise<void> => {
    setTtsError(null);
    setGenerating(true);
    try {
      const res = await generatePromptAudio(ttsText);
      onChange({
        promptAudioUrl: res.audioUrl,
        promptAudioVoiceId: res.voiceId,
        promptAudioVoiceVersion: res.voiceVersion,
      });
    } catch (err) {
      setTtsError(parseApiError(err).message);
    } finally {
      setGenerating(false);
    }
  };

  // --- Stimulus audio: the SAME controls as the prompt (upload + generate +
  //     preview + pinned voice), synthesised from the authored stimulus text. ---
  const [stimUploading, setStimUploading] = useState(false);
  const [stimGenerating, setStimGenerating] = useState(false);
  const [stimError, setStimError] = useState<string | null>(null);
  const onPickStimulus = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setStimUploading(true);
    try {
      const url = await uploadPromptAudio(file);
      onChange({
        stimulusAudioUrl: url,
        stimulusAudioVoiceId: "",
        stimulusAudioVoiceVersion: "",
      });
    } finally {
      setStimUploading(false);
    }
  };
  const onGenerateStimulus = async (): Promise<void> => {
    setStimError(null);
    setStimGenerating(true);
    try {
      const res = await generatePromptAudio(item.stimulusText.trim());
      onChange({
        stimulusAudioUrl: res.audioUrl,
        stimulusAudioVoiceId: res.voiceId,
        stimulusAudioVoiceVersion: res.voiceVersion,
      });
    } catch (err) {
      setStimError(parseApiError(err).message);
    } finally {
      setStimGenerating(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Item {index + 1}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => onMove(-1)}>↑</Button>
            <Button size="sm" variant="ghost" onClick={() => onMove(1)}>↓</Button>
            <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Type</Label>
            <select
              className="w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-ink"
              value={item.itemType}
              onChange={(e) =>
                onChange({ itemType: e.target.value as SpeakingItemTypeName })
              }
            >
              {SPEAKING_ITEM_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Section label</Label>
            <Input
              value={item.section}
              onChange={(e) => onChange({ section: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Prompt / instruction {item.itemType === "open_topic" ? "(the topic — required)" : ""}</Label>
          <Input
            value={item.promptText}
            onChange={(e) => onChange({ promptText: e.target.value })}
          />
        </div>

        {needsReference ? (
          <div className="space-y-1">
            <Label>
              Reference text {isDictation ? "(the sentence to type)" : "(what the student should say)"}
            </Label>
            <Input
              value={item.referenceText}
              onChange={(e) => onChange({ referenceText: e.target.value })}
            />
          </div>
        ) : null}

        {item.itemType === SpeakingItemType.SENTENCE_BUILD ? (
          <div className="space-y-1">
            <Label>
              Scrambled chunks the student hears (one per line, in play order)
            </Label>
            <textarea
              className="min-h-[72px] w-full rounded-lg border border-subtle bg-surface p-2 text-ink"
              placeholder={"was reading\nmy mother\nher favorite magazine"}
              value={item.chunks.join("\n")}
              onChange={(e) => onChange({ chunks: linesToArray(e.target.value) })}
            />
            <p className="text-xs text-ink-muted">
              These are synthesised (in this order) into the prompt clip the
              student hears — never the reference above, which is the withheld
              correct answer. With chunks, this becomes a listen item and needs
              audio to publish; leave empty for an on-screen jumble instead.
            </p>
          </div>
        ) : null}

        {item.itemType === "fill_missing_word" ? (
          <div className="space-y-1">
            <Label>Missing word</Label>
            <Input
              value={item.missingWord}
              onChange={(e) => onChange({ missingWord: e.target.value })}
            />
          </div>
        ) : null}

        {needsAnswerSet ? (
          <div className="space-y-1">
            <Label>Acceptable answers (one per line — alternatives all accepted)</Label>
            <textarea
              className="min-h-[72px] w-full rounded-lg border border-subtle bg-surface p-2 text-ink"
              value={item.answerSet.join("\n")}
              onChange={(e) => onChange({ answerSet: linesToArray(e.target.value) })}
            />
          </div>
        ) : null}

        {item.itemType === "story_retell" ? (
          <div className="space-y-1">
            <Label>Key facts (one per line — coverage is paraphrase-tolerant)</Label>
            <textarea
              className="min-h-[72px] w-full rounded-lg border border-subtle bg-surface p-2 text-ink"
              value={item.keyFacts.join("\n")}
              onChange={(e) => onChange({ keyFacts: linesToArray(e.target.value) })}
            />
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Prep seconds</Label>
            <Input
              type="number"
              min={0}
              value={item.prepSeconds}
              onChange={(e) => onChange({ prepSeconds: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label>Response window (s)</Label>
            <Input
              type="number"
              min={1}
              value={item.responseWindowSeconds}
              onChange={(e) =>
                onChange({ responseWindowSeconds: Number(e.target.value) })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Stimulus play limit (0 = ∞)</Label>
            <Input
              type="number"
              min={0}
              value={item.stimulusPlayLimit}
              onChange={(e) =>
                onChange({ stimulusPlayLimit: Number(e.target.value) })
              }
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Stimulus (listening clip)</Label>
            <textarea
              className="w-full rounded-md border border-subtle bg-surface-base p-2 text-sm text-ink"
              rows={2}
              placeholder="Passage / dialogue text to synthesise…"
              value={item.stimulusText}
              onChange={(e) => onChange({ stimulusText: e.target.value })}
            />
            <div className="flex flex-wrap items-center gap-3">
              {/* Mirror of the prompt controls: generate with the fixed Piper
                  voice OR upload; both set stimulusAudioUrl. */}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  stimGenerating || stimUploading || item.stimulusText.trim().length === 0
                }
                onClick={() => void onGenerateStimulus()}
              >
                {stimGenerating ? "Generating…" : "Generate audio"}
              </Button>
              <label className="text-sm text-ink-muted">
                or upload:{" "}
                <input
                  type="file"
                  accept="audio/*"
                  className="text-sm text-ink-muted"
                  onChange={(e) => void onPickStimulus(e.target.files?.[0])}
                />
              </label>
            </div>
            {stimUploading ? (
              <span className="text-xs text-ink-muted">Uploading…</span>
            ) : null}
            {stimError ? (
              <span className="text-xs text-error-fg">{stimError}</span>
            ) : null}
            {item.stimulusAudioUrl ? (
              <div className="space-y-1">
                <audio controls src={item.stimulusAudioUrl} className="h-8 w-full max-w-sm" />
                <span className="block text-xs text-success-fg">
                  Stimulus audio attached ✓
                  {item.stimulusAudioVoiceId
                    ? ` — voice ${item.stimulusAudioVoiceId} (${item.stimulusAudioVoiceVersion})`
                    : " — uploaded"}
                </span>
              </div>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>Prompt audio</Label>
            {!needsAudio ? (
              // read_aloud / open_topic have nothing to hear — the student reads
              // the on-screen text. No Generate/upload here (attaching a clip was
              // the reported bug), so it can't be confused with a listen item.
              // sentence_build is the one type where the operator can flip this on
              // by authoring chunks, so point them there instead of dead-ending.
              item.itemType === SpeakingItemType.SENTENCE_BUILD ? (
                <p className="text-xs text-ink-muted">
                  No prompt audio yet — add scrambled chunks above and a clip of
                  them (in order) becomes the spoken prompt. With no chunks this
                  is an on-screen jumble the student reads.
                </p>
              ) : (
                <p className="text-xs text-ink-muted">
                  This item type plays no prompt audio — the student reads the
                  on-screen text.
                </p>
              )
            ) : (
              <>
                {/* What the clip will SAY — EDITABLE. Empty = speak the default
                    ({ttsSourceLabel}, shown as the placeholder); type here to
                    override the spoken wording without changing the on-screen
                    prompt. sentence_build has no override (it speaks its chunks). */}
                {item.itemType === SpeakingItemType.SENTENCE_BUILD ? (
                  <div className="rounded-md border border-subtle bg-surface-base p-2">
                    <span className="block text-xs font-medium text-ink-muted">
                      Audio will say — from {ttsSourceLabel}:
                    </span>
                    {ttsText ? (
                      <span className="block text-sm text-ink">“{ttsText}”</span>
                    ) : (
                      <span className="block text-sm text-error-fg">
                        Nothing to speak yet — fill the scrambled chunks first.
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label>Audio text (defaults to the prompt / instruction)</Label>
                    <textarea
                      className="min-h-[60px] w-full rounded-md border border-subtle bg-surface-base p-2 text-sm text-ink"
                      placeholder={ttsDefaultText || "Type the prompt / instruction to speak…"}
                      value={item.promptAudioText}
                      onChange={(e) => onChange({ promptAudioText: e.target.value })}
                    />
                    <p className="text-xs text-ink-muted">
                      {item.promptAudioText.trim()
                        ? "Overriding the prompt — this exact text is spoken. Clear it to go back to the prompt."
                        : "Empty: speaks the prompt / instruction above. Type here to change only the audio."}
                    </p>
                  </div>
                )}
                <p className="text-xs text-ink-muted">
                  Speaks the prompt / instruction, never the reference text (that
                  is the answer key). When the student must HEAR a sentence that
                  stays off the screen — the one to repeat, a dialogue or passage,
                  the gapped or erroneous sentence — put it in the Stimulus box on
                  the left; the runner plays that in preference to this clip.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  {/* Generate with server-side Piper (fixed voice) OR upload a clip.
                      Both set promptAudioUrl; playback below can't tell them apart. */}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={generating || uploading || ttsText.length === 0}
                    onClick={() => void onGenerate()}
                  >
                    {generating ? "Generating…" : "Generate audio"}
                  </Button>
                  <label className="text-sm text-ink-muted">
                    or upload:{" "}
                    <input
                      type="file"
                      accept="audio/*"
                      className="text-sm text-ink-muted"
                      onChange={(e) => void onPickAudio(e.target.files?.[0])}
                    />
                  </label>
                </div>
                {uploading ? (
                  <span className="text-xs text-ink-muted">Uploading…</span>
                ) : null}
                {ttsError ? (
                  <span className="text-xs text-error-fg">{ttsError}</span>
                ) : null}
                {item.promptAudioUrl ? (
                  <div className="space-y-1">
                    {/* Hear it before saving — same control regardless of source. */}
                    <audio controls src={item.promptAudioUrl} className="h-8 w-full max-w-sm" />
                    <span className="block text-xs text-success-fg">
                      Prompt audio attached ✓
                      {item.promptAudioVoiceId
                        ? ` — voice ${item.promptAudioVoiceId} (${item.promptAudioVoiceVersion})`
                        : " — uploaded"}
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
