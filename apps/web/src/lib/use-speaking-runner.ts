/**
 * The Speaking runner orchestration hook. PROGRESSIVE DISCLOSURE: the server
 * returns only the current item, so this hook holds one `current` state
 * (SpeakingCurrentResponse) and learns the next item only from each submit's
 * `current` — it never has the full list. Owns the per-item phase walk (prompt →
 * prep → responding → submitted), the recorder (window countdown + auto-stop +
 * upload + submit), the prep countdown, prompt-audio play accounting, the
 * dictation text path, and the silent/skip path. Every item transition goes
 * through a submit so the server's current index stays authoritative. NO
 * re-record, NO going back.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  SpeakingItemType,
  type SpeakingCurrentResponse,
  type StartSpeakingResponse,
} from "@codeapt/shared";

import { api } from "./api-client.js";
import { uploadAudioToCloudinary } from "./audio-upload.js";
import { INITIAL_ITEM_PHASE, nextItemPhase, nextTick, type ItemPhase } from "./speaking-runner.js";
import { useAudioRecorder, type UseAudioRecorder } from "./use-audio-recorder.js";

export interface UseSpeakingRunner {
  index: number;
  total: number;
  item: SpeakingCurrentResponse["item"];
  phase: ItemPhase;
  recorder: UseAudioRecorder;
  prepRemaining: number;
  promptPlaysUsed: number;
  canPlayPrompt: boolean;
  notePromptPlayed: () => void;
  beginResponse: () => void;
  submitText: (text: string) => void;
  expired: boolean;
  error: string | null;
  finished: boolean;
}

export function useSpeakingRunner(opts: {
  slug: string;
  attempt: StartSpeakingResponse;
  onFinished: () => void;
}): UseSpeakingRunner {
  const { slug, attempt, onFinished } = opts;
  const [current, setCurrent] = useState<SpeakingCurrentResponse>(attempt);
  const [phase, setPhase] = useState<ItemPhase>(INITIAL_ITEM_PHASE);
  const [prepRemaining, setPrepRemaining] = useState(0);
  const [promptPlaysUsed, setPromptPlaysUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const item = current.item;
  const indexRef = useRef(current.currentIndex);
  indexRef.current = current.currentIndex;
  // Guards one advance per item (an audible upload OR a silent submit, never both).
  const advancingRef = useRef(false);
  const pendingRef = useRef<SpeakingCurrentResponse | null>(null);

  const recorder = useAudioRecorder({
    windowSeconds: item?.responseWindowSeconds ?? 30,
    onUpload: useCallback(
      async (blob: Blob) => {
        advancingRef.current = true;
        const url = await uploadAudioToCloudinary(slug, blob);
        const res = await api.collegeSpeaking.submitItem(
          slug,
          attempt.attemptId,
          indexRef.current,
          { audioUrl: url },
        );
        pendingRef.current = res.current;
      },
      [slug, attempt.attemptId],
    ),
  });

  // Request the mic once for the whole runner; per-item we only reset() back to
  // ready (the stream persists), so there's no per-item permission re-prompt.
  useEffect(() => {
    void recorder.requestMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyCurrent = useCallback(
    (next: SpeakingCurrentResponse) => {
      advancingRef.current = false;
      pendingRef.current = null;
      setPhase(INITIAL_ITEM_PHASE);
      setPrepRemaining(0);
      setPromptPlaysUsed(0);
      setError(null);
      recorder.reset();
      setCurrent(next);
      if (!next.item || next.expired) {
        setFinished(true);
        onFinished();
      }
    },
    [recorder, onFinished],
  );

  const advanceSilent = useCallback(async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      const res = await api.collegeSpeaking.submitItem(
        slug,
        attempt.attemptId,
        indexRef.current,
        { silent: true },
      );
      applyCurrent(res.current);
    } catch {
      setError("Could not record that answer. Please try the next item.");
      advancingRef.current = false;
    }
  }, [slug, attempt.attemptId, applyCurrent]);

  // React to terminal recorder states: an audible take already submitted inside
  // onUpload (advance with its `current`); a silent take submits a skip here.
  useEffect(() => {
    if (recorder.state === "uploaded") {
      if (pendingRef.current) applyCurrent(pendingRef.current);
      return;
    }
    if (recorder.state === "silent") {
      void advanceSilent();
      return;
    }
    if (recorder.state === "upload_failed") {
      setError("That answer could not be uploaded. Moving on.");
      void advanceSilent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.state]);

  // Prep countdown → open the recording window when it reaches zero.
  useEffect(() => {
    if (phase !== "prep") return undefined;
    if (prepRemaining <= 0) {
      setPhase("responding");
      return undefined;
    }
    const id = window.setInterval(() => setPrepRemaining((r) => nextTick(r)), 1000);
    return () => window.clearInterval(id);
  }, [phase, prepRemaining]);

  // Auto-start recording for an AUDIO item as soon as the window opens + mic ready.
  useEffect(() => {
    if (phase !== "responding") return;
    if (item?.itemType === SpeakingItemType.DICTATION) return;
    if (recorder.state === "ready") recorder.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, recorder.state, item?.itemType]);

  const beginResponse = useCallback(() => {
    if (!item) return;
    const next = nextItemPhase("prompt", { prepSeconds: item.prepSeconds });
    if (next === "prep") setPrepRemaining(item.prepSeconds);
    setPhase(next);
  }, [item]);

  const notePromptPlayed = useCallback(() => setPromptPlaysUsed((n) => n + 1), []);

  const submitText = useCallback(
    (text: string) => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      setPhase("submitted");
      void api.collegeSpeaking
        .submitItem(slug, attempt.attemptId, indexRef.current, { text })
        .then((res) => applyCurrent(res.current))
        .catch(() => {
          setError("That answer could not be submitted. Moving on.");
          void advanceSilent();
        });
    },
    [slug, attempt.attemptId, applyCurrent, advanceSilent],
  );

  const limit = item?.stimulusPlayLimit ?? 0;
  const canPlayPrompt = limit === 0 || promptPlaysUsed < limit;

  return {
    index: current.currentIndex,
    total: current.totalItems,
    item,
    phase,
    recorder,
    prepRemaining,
    promptPlaysUsed,
    canPlayPrompt,
    notePromptPlayed,
    beginResponse,
    submitText,
    expired: current.expired,
    error,
    finished,
  };
}
