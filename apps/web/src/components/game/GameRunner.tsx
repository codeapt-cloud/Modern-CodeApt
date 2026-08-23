/**
 * The game-attempt runner shell. Owns the item lifecycle, both clocks, the
 * answer loop, the ladder/score chrome, proctoring, and the pre-flight/results
 * transitions. It is GAME-AGNOSTIC: the actual puzzle is drawn by the renderer
 * looked up from the registry by the item's gameKey (7a ships only `_probe`).
 */
import type { StartGameSetResponse } from "@codeapt/shared";
import { AlertTriangle, Eye } from "lucide-react";

import { GAME_COPY } from "../../lib/game-copy.js";
import { ladderMove, type AnswerFeedback } from "../../lib/game-runner.js";
import { useGameRunner } from "../../lib/use-game-runner.js";
import { useProctoring } from "../../lib/use-proctoring.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Spinner } from "../ui/spinner.js";
import { GameClock, GameLadder, GameScore } from "./GameChrome.js";
import { GameResults } from "./GameResults.js";
import { GameTutorial } from "./GameTutorial.js";
import { getGameRenderer } from "./renderer-registry.js";

export function GameRunner({
  title,
  start,
  onExit,
}: {
  title: string;
  start: () => Promise<StartGameSetResponse>;
  onExit: () => void;
}): JSX.Element {
  const r = useGameRunner({ start });

  // Gaming proctoring = the SAME shared hook, configured for a game: detect
  // tab-switch/blur, block nothing (paste-blocking is irrelevant), guard unload.
  // Active only while an item is in play; warnings are recorded server-side
  // (Step 7b/A4) and force-finish the attempt past the threshold.
  useProctoring({
    active: r.phase === "playing",
    onWarning: () => void r.recordWarning(),
    block: {},
    warnOnPaste: false,
    guardUnload: true,
  });

  if (r.phase === "done" && r.result) {
    return <GameResults result={r.result} onExit={onExit} />;
  }

  if (r.phase === "error") {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-error" aria-hidden />
        <p className="mb-4 text-ink">{r.error ?? "Something went wrong."}</p>
        <Button onClick={onExit}>Back to games</Button>
      </div>
    );
  }

  if (r.phase === "loading" || r.phase === "advancing" || r.phase === "finishing") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-ink-muted">
          {r.phase === "finishing"
            ? "Tallying your score…"
            : r.phase === "advancing"
              ? "Loading the next game…"
              : "Loading…"}
        </p>
      </div>
    );
  }

  // Pre-flight: game 1 (on mount) OR the next game's tutorial (after a game
  // completes). Driven by the server's GameInfo — clock stopped, facts real.
  if (r.phase === "preflight") {
    if (!r.info) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Spinner size="lg" />
        </div>
      );
    }
    return (
      <GameTutorial
        gameKey={r.info.gameKey}
        gameNumber={r.info.gameIndex + 1}
        totalGames={r.totalGames}
        practiceMode={r.info.instantFeedback}
        allowSkip={r.info.allowSkip}
        durationSeconds={r.info.durationSeconds}
        itemSeconds={r.info.itemSeconds}
        busy={r.busy}
        onStart={() => void r.beginGame()}
      />
    );
  }

  // Playing / feedback.
  const item = r.item;
  if (!item) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  const Renderer = getGameRenderer(item.gameKey);
  const locked = r.phase === "feedback" || r.busy;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Header: game identity, ladder, score, clock(s). */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-subtle bg-surface-raised px-5 py-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">
            Game {item.gameIndex + 1} of {r.totalGames}
          </p>
          <h1 className="truncate font-semibold text-ink">
            {GAME_COPY[item.gameKey]?.name ?? title}
          </h1>
          <div className="mt-1.5">
            <GameLadder difficulty={item.difficulty} />
          </div>
        </div>
        <div className="flex items-center gap-5">
          {r.warnings > 0 ? (
            <Badge variant="warning" title="Focus-loss warnings">
              {r.warnings} warning{r.warnings === 1 ? "" : "s"}
            </Badge>
          ) : null}
          <GameScore score={r.gameScore} />
          {r.itemRemaining !== null ? (
            <GameClock seconds={r.itemRemaining} label="This item" />
          ) : null}
          <GameClock seconds={r.remaining} label="Round" />
        </div>
      </header>

      {/* Retryable answer failure (idempotent per item — a retry is safe). */}
      {r.error && r.phase === "playing" ? (
        <Alert variant="error" className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <span>{r.error}</span>
            <Button size="sm" variant="outline" onClick={() => r.retry()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {/* The puzzle. */}
      <div className="rounded-2xl border border-subtle bg-surface-raised p-6">
        {Renderer ? (
          <Renderer
            gameKey={item.gameKey}
            view={item.view}
            difficulty={item.difficulty}
            locked={locked}
            onSubmit={(submission) => r.answer(submission)}
          />
        ) : (
          <p className="text-center text-ink-muted">
            This game isn’t playable in this build yet.
          </p>
        )}
      </div>

      {/* Footer controls: skip (server-authoritative allowSkip). */}
      <div className="mt-4 flex items-center justify-between">
        <div>
          {item.allowSkip ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={locked}
              onClick={() => r.skip()}
            >
              Skip this question
            </Button>
          ) : (
            <span className="text-xs text-ink-muted">Skipping is off for this game</span>
          )}
        </div>
      </div>

      {/* Feedback step: marks + ladder move + (practice) reveal + Continue. */}
      {r.phase === "feedback" && r.feedback ? (
        <FeedbackPanel
          feedback={r.feedback}
          revealSolution={r.reveal?.solution}
          revealNote={r.reveal?.note}
          onContinue={() => r.continueAfterFeedback()}
        />
      ) : null}
    </div>
  );
}

function FeedbackPanel({
  feedback,
  revealSolution,
  revealNote,
  onContinue,
}: {
  feedback: AnswerFeedback;
  revealSolution?: unknown;
  revealNote?: string;
  onContinue: () => void;
}): JSX.Element {
  const move = ladderMove(feedback);
  const moveText =
    move === "up"
      ? `Moved up to ${cap(feedback.movedTo ?? "")}`
      : move === "down"
        ? `Moved down to ${cap(feedback.movedTo ?? "")}`
        : "";
  const tone =
    feedback.outcome === "correct"
      ? "success"
      : feedback.outcome === "expired"
        ? "warning"
        : "neutral";
  return (
    <div className="mt-4 rounded-2xl border border-subtle bg-surface-sunken p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge variant={tone}>
            {feedback.outcome === "correct"
              ? "Correct"
              : feedback.outcome === "expired"
                ? "Time up"
                : feedback.outcome === "skipped"
                  ? "Skipped"
                  : "Not quite"}
          </Badge>
          <span className="font-mono text-sm text-ink">
            +{feedback.marksAwarded}
          </span>
          {moveText ? (
            <span className="text-xs text-ink-muted">{moveText}</span>
          ) : null}
        </div>
        <Button size="sm" onClick={onContinue}>
          Continue
        </Button>
      </div>
      {revealSolution !== undefined ? (
        <div className="mt-3 flex items-start gap-2 border-t border-subtle pt-3 text-sm text-ink-muted">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {revealNote ? `${revealNote} ` : "Answer: "}
            <code className="rounded bg-surface-base px-1 py-0.5 text-xs text-ink">
              {JSON.stringify(revealSolution)}
            </code>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
