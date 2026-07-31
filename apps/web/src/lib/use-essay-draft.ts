/**
 * Essay autosave hook. Debounces draft snapshots to PUT /essays/:id/draft and
 * exposes a recovery loader for GET /essays/:id/draft — mirroring the exam
 * runner's debounced-autosave shape, scaled to long-form writing (~2.5s idle).
 *
 * It is a pure recovery buffer: it NEVER submits, grades, or consumes an
 * attempt. The composer owns the text; it feeds each change to `schedule` and
 * reads `state`/`savedAt` for the indicator. On unmount the pending timer is
 * cleared, so a save can never fire after the composer leaves (e.g. on submit),
 * which keeps an already-submitted essay from being re-drafted.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api-client.js";
import type { EssayWriterApi } from "./essay-writer-api.js";
import { shouldAutosaveDraft, type DraftSaveState } from "./essay-draft.js";

const AUTOSAVE_MS = 2500;

/**
 * `writerApi` sources the draft save/recover. Defaults to `api.essays` (the
 * individual flow, unchanged); the college writer injects a slug-bound adapter.
 */
export function useEssayDraft(
  topicId: string,
  writerApi: EssayWriterApi = api.essays,
) {
  const [state, setState] = useState<DraftSaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const lastSavedRef = useRef<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  const save = useCallback(
    async (content: string): Promise<void> => {
      if (!shouldAutosaveDraft(content, lastSavedRef.current)) return;
      setState("saving");
      try {
        const res = await writerApi.saveDraft(topicId, content);
        if (cancelled.current) return;
        lastSavedRef.current = content;
        setSavedAt(res.savedAt);
        setState("saved");
      } catch {
        if (cancelled.current) return;
        // Keep going — the next keystroke reschedules; content is never lost.
        setState("error");
      }
    },
    [topicId, writerApi],
  );

  /** Queue a debounced snapshot of the latest text. */
  const schedule = useCallback(
    (content: string): void => {
      pendingRef.current = content;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void save(pendingRef.current ?? "");
      }, AUTOSAVE_MS);
    },
    [save],
  );

  /**
   * Load the latest recoverable draft (call once on mount). Returns the draft
   * content, or null when there is nothing to restore. Records it as the
   * last-saved baseline so restoring doesn't immediately re-save the same text.
   */
  const recover = useCallback(async (): Promise<string | null> => {
    try {
      const res = await writerApi.draft(topicId);
      if (cancelled.current || !res.draft) return null;
      lastSavedRef.current = res.draft.content;
      setSavedAt(res.draft.savedAt);
      return res.draft.content;
    } catch {
      return null;
    }
  }, [topicId, writerApi]);

  return { state, savedAt, schedule, recover };
}
