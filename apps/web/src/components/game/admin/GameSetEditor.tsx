/**
 * The ONE GameSet editor, shared by the platform-admin and college surfaces via
 * an injected GameAuthoringApi adapter (mirrors the exam editor pattern). It
 * covers the whole config — title/description, an ordered games list with
 * registry-driven per-game options, selection mode + pickCount, attempts, and
 * practice flags — plus surface-specific extras: a curriculum-topic attach
 * (platform) or org-unit targeting (college), and an AI drafter on create.
 *
 * The picker and per-game defaults come from GAME_CATALOG (registry-driven), and
 * options that mean nothing for a game are hidden (onWallHit only for door_key;
 * the skip toggle only where the module allows skipping).
 */
import {
  GameSelectionMode,
  type GameKey,
  type GameSetUpsert,
  type GameSpecInput,
  type OrgUnitTreeNode,
  type Role,
} from "@codeapt/shared";
import { Plus, Sparkles, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { GAME_COPY } from "../../../lib/game-copy.js";
import {
  defaultGameSpec,
  gameOptionApplicability,
  gamePickerOptions,
  publishBlockReason,
} from "../../../lib/game-editor.js";
import type { GameAuthoringApi } from "../../../lib/game-authoring-api.js";
import { parseApiError } from "../../../lib/api-client.js";
import { OrgUnitTargetPicker } from "../../colleges/exams/OrgUnitTargetPicker.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Label } from "../../ui/label.js";
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";

type Spec = Required<GameSpecInput>;

interface Draft {
  title: string;
  description: string;
  games: Spec[];
  selectionMode: GameSetUpsert["selectionMode"];
  pickCount: number;
  maxAttempts: number;
  instantFeedback: boolean;
  perQuestionTimerSeconds: number;
  orgUnitIds: string[];
  topicId: string;
  source: GameSetUpsert["source"];
}

const EMPTY: Draft = {
  title: "",
  description: "",
  games: [],
  selectionMode: "fixed",
  pickCount: 1,
  maxAttempts: 1,
  instantFeedback: false,
  perQuestionTimerSeconds: 0,
  orgUnitIds: [],
  topicId: "",
  source: "manual",
};

const selectCls =
  "rounded-lg border border-subtle bg-surface-base px-2 py-1.5 text-sm text-ink";

export function GameSetEditor({
  authApi,
  surface,
  gameSetId,
  aiEnabled,
  orgUnitTree,
  role,
  onSaved,
  onBack,
}: {
  authApi: GameAuthoringApi;
  surface: "platform" | "college";
  gameSetId: string | null;
  aiEnabled: boolean;
  orgUnitTree?: OrgUnitTreeNode[];
  role?: Role;
  onSaved: (id: string) => void;
  onBack: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loading, setLoading] = useState(gameSetId !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  const options = useMemo(() => gamePickerOptions(), []);

  useEffect(() => {
    if (gameSetId === null) return;
    let live = true;
    void authApi
      .get(gameSetId)
      .then((d) => {
        if (!live) return;
        setDraft({
          title: d.title,
          description: d.description,
          games: d.games.map((g) => ({
            gameKey: g.gameKey,
            durationSeconds: g.durationSeconds,
            allowSkip: g.allowSkip,
            startingDifficulty: g.startingDifficulty,
            maxQuestions: g.maxQuestions,
            onWallHit: g.onWallHit,
          })),
          selectionMode: d.selectionMode,
          pickCount: d.pickCount ?? 1,
          maxAttempts: d.maxAttempts,
          instantFeedback: d.instantFeedback,
          perQuestionTimerSeconds: d.perQuestionTimerSeconds,
          orgUnitIds: d.orgUnits,
          topicId: d.topic ?? "",
          source: d.source,
        });
      })
      .catch((err) => setError(parseApiError(err).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [authApi, gameSetId]);

  const setGame = (i: number, patch: Partial<Spec>): void =>
    setDraft((d) => ({
      ...d,
      games: d.games.map((g, j) => (j === i ? { ...g, ...patch } : g)),
    }));
  const addGame = (key: GameKey): void =>
    setDraft((d) => ({ ...d, games: [...d.games, defaultGameSpec(key)] }));
  const removeGame = (i: number): void =>
    setDraft((d) => ({ ...d, games: d.games.filter((_, j) => j !== i) }));
  const moveGame = (i: number, dir: -1 | 1): void =>
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.games.length) return d;
      const games = [...d.games];
      [games[i], games[j]] = [games[j]!, games[i]!];
      return { ...d, games };
    });

  async function runAi(): Promise<void> {
    setAiBusy(true);
    setAiMessage(null);
    try {
      const res = await authApi.aiBuild(brief);
      if (!res.draft) {
        setAiMessage(
          res.configured
            ? "The AI couldn’t draft a set right now — compose it manually below."
            : "AI drafting is unavailable — compose the set manually below.",
        );
        return;
      }
      const d = res.draft;
      setDraft((prev) => ({
        ...prev,
        title: d.title,
        description: d.description,
        games: d.games.map((g) => ({
          gameKey: g.gameKey,
          durationSeconds: g.durationSeconds,
          allowSkip: g.allowSkip,
          startingDifficulty: g.startingDifficulty,
          maxQuestions: g.maxQuestions,
          onWallHit: g.onWallHit,
        })),
        selectionMode: d.selectionMode,
        pickCount: d.pickCount ?? 1,
        maxAttempts: d.maxAttempts,
        instantFeedback: d.instantFeedback,
        perQuestionTimerSeconds: d.perQuestionTimerSeconds,
        source: "ai_drafted",
      }));
      setAiMessage("Draft loaded — review and edit before saving.");
    } catch (err) {
      setAiMessage(parseApiError(err).message);
    } finally {
      setAiBusy(false);
    }
  }

  const blockReason = publishBlockReason(draft);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const body: GameSetUpsert = {
      title: draft.title.trim(),
      description: draft.description,
      games: draft.games,
      selectionMode: draft.selectionMode,
      pickCount:
        draft.selectionMode === GameSelectionMode.RANDOM_N_OF_POOL
          ? draft.pickCount
          : undefined,
      orgUnitIds: surface === "college" ? draft.orgUnitIds : [],
      topicId:
        surface === "platform" && draft.topicId.trim()
          ? draft.topicId.trim()
          : undefined,
      perQuestionTimerSeconds: draft.perQuestionTimerSeconds,
      instantFeedback: draft.instantFeedback,
      maxAttempts: draft.maxAttempts,
      source: draft.source,
    };
    try {
      const saved =
        gameSetId === null
          ? await authApi.create(body)
          : await authApi.update(gameSetId, body);
      onSaved(saved.id);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-6 text-ink-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-center justify-between">
        <button className="text-sm text-ink-muted hover:text-ink" onClick={onBack}>
          ← Back
        </button>
        {draft.source === "ai_drafted" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <Sparkles className="h-3 w-3" /> AI-drafted
          </span>
        ) : null}
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      {/* AI drafter (create only). Absent when the feature is unavailable. */}
      {gameSetId === null && aiEnabled ? (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Sparkles className="h-4 w-4 text-primary" /> Draft with AI
            </div>
            <p className="text-xs text-ink-muted">
              Describe what you want; the AI composes a configuration (which games,
              timings, difficulty) for you to review. It never writes game content.
            </p>
            <Textarea
              rows={2}
              value={brief}
              placeholder="e.g. A quick 3-game warm-up for first-years, easy start, 2 minutes each."
              onChange={(e) => setBrief(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <Button size="sm" loading={aiBusy} disabled={!brief.trim()} onClick={() => void runAi()}>
                Draft with AI
              </Button>
              {aiMessage ? <span className="text-xs text-ink-muted">{aiMessage}</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="gs-title">Title</Label>
        <Input
          id="gs-title"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
        <Label htmlFor="gs-desc">Description</Label>
        <Textarea
          id="gs-desc"
          rows={2}
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
      </div>

      {/* Games list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Games ({draft.games.length})</h2>
        </div>
        {draft.games.map((g, i) => {
          const applic = gameOptionApplicability(g.gameKey);
          return (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">
                    {i + 1}. {GAME_COPY[g.gameKey]?.name ?? g.gameKey}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => moveGame(i, -1)} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" disabled={i === draft.games.length - 1} onClick={() => moveGame(i, 1)} aria-label="Move down">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeGame(i)} aria-label="Remove">
                      <Trash2 className="h-4 w-4 text-error" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    Clock (s)
                    <Input
                      type="number"
                      className="w-20"
                      value={g.durationSeconds}
                      onChange={(e) => setGame(i, { durationSeconds: Number(e.target.value) })}
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Start
                    <select
                      className={selectCls}
                      value={g.startingDifficulty}
                      onChange={(e) => setGame(i, { startingDifficulty: e.target.value as Spec["startingDifficulty"] })}
                    >
                      <option value="easy">Easy</option>
                      <option value="moderate">Moderate</option>
                      <option value="hard">Hard</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    Max Qs
                    <Input
                      type="number"
                      className="w-20"
                      value={g.maxQuestions}
                      onChange={(e) => setGame(i, { maxQuestions: Number(e.target.value) })}
                    />
                  </label>
                  {applic.allowSkip ? (
                    <label className="flex items-center gap-1.5">
                      <Switch checked={g.allowSkip} onCheckedChange={(v) => setGame(i, { allowSkip: v })} />
                      Allow skip
                    </label>
                  ) : (
                    <span className="text-xs text-ink-muted">Skip off (game rule)</span>
                  )}
                  {applic.onWallHit ? (
                    <label className="flex items-center gap-1.5">
                      Wall hit
                      <select
                        className={selectCls}
                        value={g.onWallHit}
                        onChange={(e) => setGame(i, { onWallHit: e.target.value as Spec["onWallHit"] })}
                      >
                        <option value="block">Block (stay)</option>
                        <option value="reset">Reset (to start)</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <Button key={o.key} variant="outline" size="sm" onClick={() => addGame(o.key)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> {o.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Set-level config */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Selection
          <select
            className={selectCls}
            value={draft.selectionMode}
            onChange={(e) => setDraft((d) => ({ ...d, selectionMode: e.target.value as Draft["selectionMode"] }))}
          >
            <option value="fixed">Fixed — play all, in order</option>
            <option value="random_n_of_pool">Random — pick N of the pool</option>
          </select>
        </label>
        {draft.selectionMode === "random_n_of_pool" ? (
          <label className="flex flex-col gap-1 text-sm">
            Pick count
            <Input
              type="number"
              value={draft.pickCount}
              onChange={(e) => setDraft((d) => ({ ...d, pickCount: Number(e.target.value) }))}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          Max attempts (0 = unlimited)
          <Input
            type="number"
            value={draft.maxAttempts}
            onChange={(e) => setDraft((d) => ({ ...d, maxAttempts: Number(e.target.value) }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Practice per-question timer (s, 0 = none)
          <Input
            type="number"
            value={draft.perQuestionTimerSeconds}
            onChange={(e) => setDraft((d) => ({ ...d, perQuestionTimerSeconds: Number(e.target.value) }))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.instantFeedback} onCheckedChange={(v) => setDraft((d) => ({ ...d, instantFeedback: v }))} />
          Practice mode (reveal answers)
        </label>
      </div>

      {/* Platform: attach to a curriculum GAME topic */}
      {surface === "platform" ? (
        <div className="space-y-1">
          <Label htmlFor="gs-topic">Curriculum topic id (optional — course-attached set)</Label>
          <Input
            id="gs-topic"
            value={draft.topicId}
            placeholder="A GAME topic id, or leave blank"
            onChange={(e) => setDraft((d) => ({ ...d, topicId: e.target.value }))}
          />
        </div>
      ) : null}

      {/* College: org-unit targeting */}
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

      {blockReason ? (
        <Alert variant="warning">Not publishable yet: {blockReason}</Alert>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onBack}>
          Cancel
        </Button>
        <Button loading={saving} disabled={!draft.title.trim() || draft.games.length === 0} onClick={() => void save()}>
          {gameSetId === null ? "Create draft" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
