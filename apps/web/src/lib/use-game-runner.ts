/**
 * Game-attempt runner — the gaming analogue of use-exam-runner. Drives the whole
 * play sequence with the SAME timing discipline: a single re-syncable countdown
 * where the SERVER value (remainingSeconds / itemRemainingSeconds) from every
 * response overwrites local ticks; local ticking only smooths between responses.
 *
 * Clock/tutorial ordering (see the step report): the server sets `expiresAt` at
 * SERVE time (inside start/advance), so to keep the clock STOPPED while the
 * tutorial is up we defer start/advance to the tutorial's "Start" — `beginGame`
 * serves the first item of a game exactly when the player commits to begin it.
 *
 * Phases: preflight (game-1 tutorial, clock stopped) → playing → feedback (marks
 * + optional practice reveal) → either the next item (no round-trip; `next` came
 * with the answer) or game-complete (the next game's tutorial) → finish → done.
 */
import {
  type AnswerGameItemResponse,
  type GameDifficulty,
  type GameExplanationResponse,
  type GameItemView,
  type GameKey,
  type GameResult,
  type StartGameSetResponse,
} from "@codeapt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, parseApiError } from "./api-client.js";
import {
  clockFromItem,
  feedbackFromAnswer,
  nextTick,
  type AnswerFeedback,
} from "./game-runner.js";

export type GamePhase =
  | "preflight"
  | "playing"
  | "feedback"
  | "game-complete"
  | "advancing"
  | "finishing"
  | "done"
  | "error";

export interface UseGameRunnerArgs {
  /** Serves game 1: the shell passes the correct start (global vs tenant). */
  start: () => Promise<StartGameSetResponse>;
  /** The set's game keys — used for the game-1 tutorial before the server
   * resolves the sequence. Order is authoritative for fixed sets. */
  gameKeys: GameKey[];
}

const AUTO_ADVANCE_MS = 1100;

export function useGameRunner({ start, gameKeys }: UseGameRunnerArgs) {
  const [phase, setPhase] = useState<GamePhase>("preflight");
  const [started, setStarted] = useState(false);
  const [item, setItem] = useState<GameItemView | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [itemRemaining, setItemRemaining] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [reveal, setReveal] = useState<GameExplanationResponse | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [sequence, setSequence] = useState<GameKey[]>([]);
  const [gameIndex, setGameIndex] = useState(0);
  const [totalGames, setTotalGames] = useState(gameKeys.length);
  const [gameScore, setGameScore] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attemptRef = useRef<string | null>(null);
  const tokenRef = useRef<string | undefined>(undefined);
  const pendingNext = useRef<GameItemView | null>(null);
  const pendingComplete = useRef(false);
  const lastSubmission = useRef<unknown>(undefined);
  const expiredRef = useRef(false);
  const autoTimer = useRef<number | null>(null);

  const clearAuto = (): void => {
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    autoTimer.current = null;
  };
  useEffect(() => clearAuto, []);

  const loadItem = useCallback((next: GameItemView): void => {
    expiredRef.current = false;
    setItem(next);
    const clock = clockFromItem(next);
    setRemaining(clock.remaining); // server value — authoritative
    setItemRemaining(clock.itemRemaining);
    setReveal(null);
    setFeedback(null);
    setPhase("playing");
  }, []);

  const finish = useCallback(async (): Promise<void> => {
    const attemptId = attemptRef.current;
    if (!attemptId) return;
    setPhase("finishing");
    try {
      const res = await api.games.finish(attemptId, tokenRef.current);
      setResult(res);
      setPhase("done");
    } catch (err) {
      setError(parseApiError(err).message);
      setPhase("error");
    }
  }, []);

  const continueAfterFeedback = useCallback((): void => {
    clearAuto();
    if (pendingComplete.current || !pendingNext.current) {
      setPhase("game-complete");
    } else {
      loadItem(pendingNext.current);
      pendingNext.current = null;
    }
  }, [loadItem]);

  const applyAnswerResponse = useCallback(
    async (res: AnswerGameItemResponse): Promise<void> => {
      setFeedback(feedbackFromAnswer(res));
      setGameScore(res.gameScore);
      pendingNext.current = res.next;
      pendingComplete.current = res.gameComplete;
      // Practice mode: fetch + show the reveal, and WAIT for the player.
      if (item?.instantFeedback && attemptRef.current) {
        try {
          const ex = await api.games.explain(
            attemptRef.current,
            res.itemIndex,
            tokenRef.current,
          );
          setReveal(ex);
        } catch {
          /* reveal is best-effort; feedback still shows */
        }
      }
      setPhase("feedback");
      if (!item?.instantFeedback) {
        // Non-practice: brief flash, then auto-continue (a click can skip it).
        autoTimer.current = window.setTimeout(
          continueAfterFeedback,
          AUTO_ADVANCE_MS,
        );
      }
    },
    [item, continueAfterFeedback],
  );

  const sendAnswer = useCallback(
    async (action: "answer" | "skip", submission: unknown): Promise<void> => {
      const attemptId = attemptRef.current;
      const current = item;
      if (!attemptId || !current) return;
      lastSubmission.current = submission;
      setBusy(true);
      setError(null);
      try {
        const res = await api.games.answer(
          attemptId,
          { itemIndex: current.itemIndex, action, submission },
          tokenRef.current,
        );
        await applyAnswerResponse(res);
      } catch (err) {
        // The answer endpoint is idempotent per itemIndex, so retrying the same
        // item is safe — keep the item playable and surface a retry.
        setError(parseApiError(err).message);
        setPhase("playing");
      } finally {
        setBusy(false);
      }
    },
    [item, applyAnswerResponse],
  );

  const answer = useCallback(
    (submission: unknown): void => void sendAnswer("answer", submission),
    [sendAnswer],
  );
  const skip = useCallback(
    (): void => void sendAnswer("skip", undefined),
    [sendAnswer],
  );
  const retry = useCallback(
    (): void => void sendAnswer("answer", lastSubmission.current),
    [sendAnswer],
  );

  const beginGame = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (!attemptRef.current) {
        const res = await start();
        attemptRef.current = res.attemptId;
        tokenRef.current = res.attemptToken;
        setStarted(true);
        setSequence(res.sequence);
        setTotalGames(res.totalGames);
        setGameIndex(0);
        setGameScore(0);
        loadItem(res.item);
      } else {
        setPhase("advancing");
        const res = await api.games.advance(attemptRef.current, tokenRef.current);
        if (res.setComplete || !res.item) {
          await finish();
          return;
        }
        setGameIndex((g) => g + 1);
        setGameScore(0);
        loadItem(res.item);
      }
    } catch (err) {
      setError(parseApiError(err).message);
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }, [start, loadItem, finish]);

  // Client clock hits 0 → lock the item (server is authoritative and records
  // `expired`). Prefer skip when allowed so a not-quite-expired server clock
  // records `skipped`, never a bogus wrong.
  const expire = useCallback((): void => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    if (item?.allowSkip) void sendAnswer("skip", undefined);
    else void sendAnswer("answer", {});
  }, [item, sendAnswer]);

  // Single countdown interval; server values overwrite it on every loadItem.
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => {
      setRemaining((r) => nextTick(r));
      setItemRemaining((r) => (r === null ? null : nextTick(r)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, item?.itemIndex]);

  useEffect(() => {
    if (phase !== "playing" || expiredRef.current) return;
    if (remaining <= 0 || (itemRemaining !== null && itemRemaining <= 0)) {
      expire();
    }
  }, [remaining, itemRemaining, phase, expire]);

  // The game whose TUTORIAL is showing is always the UPCOMING one: game 1 before
  // start, else the next in the resolved sequence.
  const upcomingIndex = started ? gameIndex + 1 : 0;
  const tutorialGameKey: GameKey | null = started
    ? (sequence[upcomingIndex] ?? null)
    : (gameKeys[0] ?? null);

  return {
    phase,
    item,
    remaining,
    itemRemaining,
    feedback,
    reveal,
    result,
    sequence,
    gameIndex,
    totalGames,
    gameScore,
    error,
    busy,
    difficulty: (item?.difficulty ?? "easy") as GameDifficulty,
    /** Key + 1-based number of the game whose tutorial is up. */
    tutorialGameKey,
    tutorialGameNumber: upcomingIndex + 1,
    beginGame,
    answer,
    skip,
    retry,
    continueAfterFeedback,
    finish,
  };
}
