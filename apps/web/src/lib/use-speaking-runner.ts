/**
 * The Speaking runner orchestration hook — the I/O + clock layer the pure
 * speaking-runner.ts decisions sit under (mirrors use-game-runner over
 * game-runner). Owns: the per-item phase walk (prompt → prep → responding →
 * submitted), the audio recorder (window countdown + auto-stop + upload +
 * submit), the prep countdown, prompt-audio play-limit accounting, the dictation
 * text-submit path, and auto-advance. NO re-record, NO going back — advancing is
 * the only motion, exactly like the existing read_aloud runner.
 */
import { useCallback, useEffect, useState } from "react";

import { SpeakingItemType, type StartSpeakingResponse } from "@codeapt/shared";

import { api } from "./api-client.js";
import { uploadAudioToCloudinary } from "./audio-upload.js";
import { INITIAL_ITEM_PHASE, nextItemPhase, nextTick, type ItemPhase } from "./speaking-runner.js";
import { useAudioRecorder, type UseAudioRecorder } from "./use-audio-recorder.js";

export interface UseSpeakingRunner {
  index: number;
  total: number;
  item: StartSpeakingResponse["items"][number] | undefined;
  phase: ItemPhase;
  recorder: UseAudioRecorder;
  /** Prep countdown (seconds) while phase === "prep". */
  prepRemaining: number;
  /** How many times the prompt/stimulus audio has been played this item. */
  promptPlaysUsed: number;
  /** Whether another prompt play is allowed (respecting stimulusPlayLimit). */
  canPlayPrompt: boolean;
  notePromptPlayed: () => void;
  /** prompt → (prep | responding). Starts the recorder immediately for a
   *  no-prep audio item. */
  beginResponse: () => void;
  /** dictation: submit typed text (no audio); finalizes the item inline. */
  submitText: (text: string) => void;
  error: string | null;
  finished: boolean;
}

export function useSpeakingRunner(opts: {
  slug: string;
  attempt: StartSpeakingResponse;
  onFinished: () => void;
}): UseSpeakingRunner {
  const { slug, attempt, onFinished } = opts;
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<ItemPhase>(INITIAL_ITEM_PHASE);
  const [prepRemaining, setPrepRemaining] = useState(0);
  const [promptPlaysUsed, setPromptPlaysUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const item = attempt.items[index];

  // Upload closure — bound to the CURRENT index so a late upload can't submit to
  // the wrong item. Spoken items only; dictation uses submitText.
  const onUpload = useCallback(
    async (blob: Blob) => {
      const url = await uploadAudioToCloudinary(slug, blob);
      await api.collegeSpeaking.submitItem(slug, attempt.attemptId, index, {
        audioUrl: url,
      });
    },
    [slug, attempt.attemptId, index],
  );

  const recorder = useAudioRecorder({
    windowSeconds: item?.responseWindowSeconds ?? 30,
    onUpload,
  });

  // Reset per-item UI state and re-request the mic when the item changes.
  useEffect(() => {
    setPhase(INITIAL_ITEM_PHASE);
    setPrepRemaining(0);
    setPromptPlaysUsed(0);
    setError(null);
    void recorder.requestMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const advance = useCallback(() => {
    if (index + 1 < attempt.items.length) {
      setIndex((i) => i + 1);
    } else {
      setFinished(true);
      onFinished();
    }
  }, [index, attempt.items.length, onFinished]);

  // Auto-advance once a spoken item is uploaded (or was silent — a silent take
  // is still an attempt; no re-record). Surface an upload failure calmly.
  useEffect(() => {
    if (recorder.state === "uploaded" || recorder.state === "silent") {
      const t = setTimeout(advance, 1200);
      return () => clearTimeout(t);
    }
    if (recorder.state === "upload_failed") {
      setError("That answer could not be uploaded. Moving on.");
      const t = setTimeout(advance, 1600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [recorder.state, advance]);

  // Prep countdown: tick down to zero, then open the recording window.
  useEffect(() => {
    if (phase !== "prep") return undefined;
    if (prepRemaining <= 0) {
      setPhase("responding");
      return undefined;
    }
    const id = window.setInterval(() => setPrepRemaining((r) => nextTick(r)), 1000);
    return () => window.clearInterval(id);
  }, [phase, prepRemaining]);

  // When the recording window opens for an AUDIO item, start recording as soon
  // as the mic is ready (after prep, or immediately for a no-prep item).
  useEffect(() => {
    if (phase !== "responding") return;
    if (item?.itemType === SpeakingItemType.DICTATION) return; // typed, no mic
    if (recorder.state === "ready") recorder.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, recorder.state, item?.itemType]);

  const beginResponse = useCallback(() => {
    if (!item) return;
    const next = nextItemPhase("prompt", { prepSeconds: item.prepSeconds });
    if (next === "prep") setPrepRemaining(item.prepSeconds);
    setPhase(next);
  }, [item]);

  const notePromptPlayed = useCallback(() => {
    setPromptPlaysUsed((n) => n + 1);
  }, []);

  const submitText = useCallback(
    (text: string) => {
      setPhase("submitted");
      void api.collegeSpeaking
        .submitItem(slug, attempt.attemptId, index, { text })
        .then(advance)
        .catch(() => {
          setError("That answer could not be submitted. Moving on.");
          setTimeout(advance, 1600);
        });
    },
    [slug, attempt.attemptId, index, advance],
  );

  const limit = item?.stimulusPlayLimit ?? 0;
  const canPlayPrompt = limit === 0 || promptPlaysUsed < limit;

  return {
    index,
    total: attempt.items.length,
    item,
    phase,
    recorder,
    prepRemaining,
    promptPlaysUsed,
    canPlayPrompt,
    notePromptPlayed,
    beginResponse,
    submitText,
    error,
    finished,
  };
}
