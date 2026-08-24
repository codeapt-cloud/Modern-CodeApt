/**
 * Game-attempt runner — the gaming analogue of use-exam-runner, on the Step-7b
 * lazy-clock flow. `start(serve:false)` runs on mount and returns the first
 * game's pre-flight INFO with NO clock; the tutorial's "Start" calls `begin`,
 * which serves the first item and starts the server-set clock. Between games,
 * `advance(serve:false)` returns the next game's info (clock still stopped) and
 * the next tutorial shows; its "Start" calls `begin` again.
 *
 * Timing discipline mirrors the exam runner exactly: the server's
 * remainingSeconds / itemRemainingSeconds from EVERY response overwrite local
 * ticks; local ticking only smooths between responses. On a client-side clock
 * expiry the runner sends action "expire" and lets the SERVER decide — a 409
 * (server clock still live) is ignored so play resumes, never a bogus wrong.
 */
import {
  type AnswerGameItemResponse,
  type GameDifficulty,
  type GameExplanationResponse,
  type GameInfo,
  type GameItemView,
  type GameKey,
  type GameResult,
  type StartGameSetResponse,
} from "@codeapt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import type { GameProbeResult } from "../components/game/renderer-contract.js";
import { api, parseApiError } from "./api-client.js";
import {
  clockFromItem,
  feedbackFromAnswer,
  nextTick,
  type AnswerFeedback,
} from "./game-runner.js";

export type GamePhase =
  | "loading"
  | "preflight"
  | "playing"
  | "feedback"
  | "advancing"
  | "finishing"
  | "done"
  | "error";

export interface UseGameRunnerArgs {
  /** The deferred start thunk (serve:false), supplied by the shell so it can
   * choose the global vs tenant start endpoint. */
  start: () => Promise<StartGameSetResponse>;
}

const AUTO_ADVANCE_MS = 1100;

export function useGameRunner({ start }: UseGameRunnerArgs) {
  const [phase, setPhase] = useState<GamePhase>("loading");
  const [info, setInfo] = useState<GameInfo | null>(null);
  const [item, setItem] = useState<GameItemView | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [itemRemaining, setItemRemaining] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [reveal, setReveal] = useState<GameExplanationResponse | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [totalGames, setTotalGames] = useState(0);
  const [gameScore, setGameScore] = useState(0);
  const [warnings, setWarnings] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attemptRef = useRef<string | null>(null);
  const tokenRef = useRef<string | undefined>(undefined);
  const pendingNext = useRef<GameItemView | null>(null);
  const pendingComplete = useRef(false);
  const lastSubmission = useRef<unknown>(undefined);
  const expiredRef = useRef(false);
  const autoTimer = useRef<number | null>(null);
  const startedRef = useRef(false);

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

  /** Tutorial "Start": serve the current game's first item + start its clock. */
  const beginGame = useCallback(async (): Promise<void> => {
    const attemptId = attemptRef.current;
    if (!attemptId) return;
    setBusy(true);
    setError(null);
    setGameScore(0);
    try {
      const res = await api.games.begin(attemptId, tokenRef.current);
      loadItem(res.item);
    } catch (err) {
      setError(parseApiError(err).message);
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }, [loadItem]);

  // A game finished → get the next game's pre-flight info (serve:false), or
  // finish the set. Runs automatically after the last item's feedback.
  const advanceToNext = useCallback(async (): Promise<void> => {
    const attemptId = attemptRef.current;
    if (!attemptId) return;
    setPhase("advancing");
    try {
      const res = await api.games.advance(attemptRef.current!, tokenRef.current, false);
      if (res.setComplete || !res.nextGame) {
        await finish();
        return;
      }
      setInfo(res.nextGame);
      setPhase("preflight");
    } catch (err) {
      setError(parseApiError(err).message);
      setPhase("error");
    }
  }, [finish]);

  const continueAfterFeedback = useCallback((): void => {
    clearAuto();
    if (pendingComplete.current || !pendingNext.current) {
      void advanceToNext();
    } else {
      loadItem(pendingNext.current);
      pendingNext.current = null;
    }
  }, [advanceToNext, loadItem]);

  // Mount = RESUME-OR-START (Step 22 G1). The server resolves whether this is a
  // fresh attempt or an existing in-progress one (keyed on user+gameSet, so a
  // refresh — which lost our attemptId — still finds it). We restore from what it
  // returns, with the SERVER's clocks, and NEVER re-show the tutorial for a game
  // whose clock is already running:
  //   - `item` present  → drop straight into play (fresh serve:true, or resume
  //     mid-item with its accumulated probeState + reduced clock).
  //   - `awaitingAdvance`→ a refresh landed between games → advance, don't tutorial.
  //   - otherwise        → pre-flight tutorial (clock not started yet).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const res = await start();
        attemptRef.current = res.attemptId;
        tokenRef.current = res.attemptToken;
        setTotalGames(res.totalGames);
        setGameScore(0);
        setInfo(res.currentGame);
        if (res.item) {
          loadItem(res.item);
        } else if (res.awaitingAdvance) {
          void advanceToNext();
        } else {
          setPhase("preflight");
        }
      } catch (err) {
        setError(parseApiError(err).message);
        setPhase("error");
      }
    })();
  }, [start, loadItem, advanceToNext]);

  const applyAnswerResponse = useCallback(
    async (res: AnswerGameItemResponse): Promise<void> => {
      setFeedback(feedbackFromAnswer(res));
      setGameScore(res.gameScore);
      pendingNext.current = res.next;
      pendingComplete.current = res.gameComplete;
      if (item?.instantFeedback && attemptRef.current) {
        try {
          const ex = await api.games.explain(
            attemptRef.current,
            res.itemIndex,
            tokenRef.current,
          );
          setReveal(ex);
        } catch {
          /* reveal is best-effort */
        }
      }
      setPhase("feedback");
      if (!item?.instantFeedback) {
        autoTimer.current = window.setTimeout(
          continueAfterFeedback,
          AUTO_ADVANCE_MS,
        );
      }
    },
    [item, continueAfterFeedback],
  );

  const sendAnswer = useCallback(
    async (
      action: "answer" | "skip" | "expire",
      submission: unknown,
    ): Promise<void> => {
      const attemptId = attemptRef.current;
      const current = item;
      if (!attemptId || !current) return;
      if (action !== "expire") lastSubmission.current = submission;
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
        const parsed = parseApiError(err);
        // A3: the server clock disagreed the item expired — it is still live.
        // Resume play; the next real expiry (or answer) proceeds normally.
        if (parsed.code === "GAME_NOT_EXPIRED") {
          expiredRef.current = false;
          setPhase("playing");
          return;
        }
        // The answer endpoint is idempotent per item, so a retry is safe.
        setError(parsed.message);
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

  // Client clock hit 0 → ask the SERVER to expire it (A3). No bogus wrong.
  const expire = useCallback((): void => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    void sendAnswer("expire", undefined);
  }, [sendAnswer]);

  // INTERACTIVE (door_key, 7c): one move through the probe channel. Returns the
  // redacted next view for the renderer to draw. On RESOLUTION we funnel through
  // the SAME feedback/next path as one-shot answers — the server already shares
  // finalizeItem (ladder/marks/score identical); here we only adapt the probe
  // response's two display-only omissions (`correct` is derivable from outcome;
  // `answeredDifficulty` is the current item's own difficulty).
  const probe = useCallback(
    async (action: unknown): Promise<GameProbeResult> => {
      const attemptId = attemptRef.current;
      const current = item;
      if (!attemptId || !current) {
        return { view: null, movesUsed: 0, resolved: false, outcome: null };
      }
      const res = await api.games.probe(
        attemptId,
        { itemIndex: current.itemIndex, action },
        tokenRef.current,
      );
      if (res.resolved) {
        await applyAnswerResponse({
          itemIndex: res.itemIndex,
          outcome: res.outcome ?? "wrong",
          marksAwarded: res.marksAwarded ?? 0,
          answeredDifficulty: current.difficulty,
          gameScore: res.gameScore,
          questionsCorrect: 0, // not shown in feedback
          questionsAttempted: 0,
          correct: res.outcome === "correct",
          next: res.next,
          gameComplete: res.gameComplete,
        });
      }
      return {
        view: res.view,
        movesUsed: res.movesUsed,
        resolved: res.resolved,
        outcome: res.outcome,
      };
    },
    [item, applyAnswerResponse],
  );

  const recordWarning = useCallback(async (): Promise<void> => {
    const attemptId = attemptRef.current;
    if (!attemptId) return;
    try {
      const res = await api.games.warning(attemptId, tokenRef.current);
      setWarnings(res.warningsTriggered);
      if (res.autoFinished) void finish();
    } catch {
      /* best-effort */
    }
  }, [finish]);

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

  return {
    phase,
    info,
    item,
    remaining,
    itemRemaining,
    feedback,
    reveal,
    result,
    totalGames,
    gameScore,
    warnings,
    error,
    busy,
    difficulty: (item?.difficulty ?? "easy") as GameDifficulty,
    gameKey: (item?.gameKey ?? info?.gameKey ?? null) as GameKey | null,
    beginGame,
    answer,
    skip,
    retry,
    probe,
    continueAfterFeedback,
    finish,
    recordWarning,
  };
}
