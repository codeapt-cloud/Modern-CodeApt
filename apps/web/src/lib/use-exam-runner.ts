/**
 * Exam-runner orchestrator. Given a started attempt (initial section view +
 * optional attempt token), it drives the whole taking experience:
 *   - a single re-syncable countdown (server time is truth; local ticks are a
 *     display that we overwrite from every server response),
 *   - debounced, coalesced autosave with SECTION_EXPIRED handling,
 *   - no-reload section transitions (advance),
 *   - timer expiry → auto-advance or auto-submit,
 *   - submit → poll finalize until grading completes → result,
 *   - warning recording (anti-cheat) with reconciled counts.
 *
 * All engine calls send the X-Attempt-Token when `token` is set (anonymous
 * public takers); logged-in takers rely on the session cookie.
 */
import {
  ExamErrorCode,
  type AnswerInput,
  type AttemptSectionView,
  type CodeLanguage,
  type ExamResult,
} from "@codeapt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, parseApiError } from "./api-client.js";
import {
  clampIndex,
  isLastSection,
  seedAnswers,
  type LocalAnswer,
} from "./exam-runner.js";

export type RunnerPhase =
  "running" | "advancing" | "submitting" | "grading" | "done" | "error";

const AUTOSAVE_MS = 800;
const FINALIZE_POLL_MS = 1000;

function toPayload(questionId: string, a: LocalAnswer): AnswerInput {
  const out: AnswerInput = { questionId };
  if (a.selectedOptions) out.selectedOptions = a.selectedOptions;
  if (a.code !== undefined) out.code = a.code;
  if (a.language) out.language = a.language as CodeLanguage;
  return out;
}

export function useExamRunner(params: {
  attemptId: string;
  token: string | null;
  initial: AttemptSectionView;
}) {
  const { attemptId } = params;
  const token = params.token ?? undefined;

  const [view, setView] = useState<AttemptSectionView>(params.initial);
  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>(() =>
    seedAnswers(params.initial.questions),
  );
  const [remaining, setRemaining] = useState(
    params.initial.sectionRemainingSeconds,
  );
  const [phase, setPhase] = useState<RunnerPhase>("running");
  const [result, setResult] = useState<ExamResult | null>(null);
  const [warnings, setWarnings] = useState(0);
  const [malpractice, setMalpractice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One-question-at-a-time navigation (within the current section only).
  const [currentIndex, setCurrentIndex] = useState(0);
  const seedMarked = (v: AttemptSectionView): Set<string> =>
    new Set(v.markedForReview);
  // "Visited" is client-only UI state; answered/marked questions were opened.
  const seedVisited = (v: AttemptSectionView): Set<string> => {
    const s = new Set<string>(v.markedForReview);
    for (const q of v.questions) if (q.savedAnswer) s.add(q.id);
    if (v.questions[0]) s.add(v.questions[0].id);
    return s;
  };
  const [markedForReview, setMarkedForReview] = useState<Set<string>>(() =>
    seedMarked(params.initial),
  );
  const [visited, setVisited] = useState<Set<string>>(() =>
    seedVisited(params.initial),
  );

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const dirtyRef = useRef<Set<string>>(new Set());
  const markedRef = useRef<Set<string>>(markedForReview);
  markedRef.current = markedForReview;
  const marksDirtyRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const expiredRef = useRef(false);
  const expireFnRef = useRef<() => void>(() => {});
  const finalizeTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (finalizeTimer.current) window.clearTimeout(finalizeTimer.current);
    saveTimer.current = null;
    finalizeTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // --- Autosave -------------------------------------------------------------

  const doSave = useCallback(async (): Promise<void> => {
    const dirty = [...dirtyRef.current];
    const marksDirty = marksDirtyRef.current;
    if (dirty.length === 0 && !marksDirty) return;
    dirtyRef.current.clear();
    marksDirtyRef.current = false;
    const payload = dirty.map((qid) =>
      toPayload(qid, answersRef.current[qid] ?? {}),
    );
    // Persist marks (this section's set) only when they changed, so answer-only
    // saves leave marks untouched server-side.
    const marked = marksDirty ? [...markedRef.current] : undefined;
    setSaving(true);
    try {
      const res = await api.exams.saveAnswers(attemptId, payload, token, marked);
      setRemaining(res.sectionRemainingSeconds); // re-sync with server
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.code === ExamErrorCode.SECTION_EXPIRED) {
        expireFnRef.current();
      } else {
        // Keep the answers/marks dirty so the next flush retries them.
        dirty.forEach((q) => dirtyRef.current.add(q));
        if (marksDirty) marksDirtyRef.current = true;
      }
    } finally {
      setSaving(false);
    }
  }, [attemptId, token]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void doSave(), AUTOSAVE_MS);
  }, [doSave]);

  const flushSave = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await doSave();
  }, [doSave]);

  const setAnswer = useCallback(
    (questionId: string, patch: LocalAnswer) => {
      setAnswers((prev) => ({
        ...prev,
        [questionId]: { ...prev[questionId], ...patch },
      }));
      dirtyRef.current.add(questionId);
      scheduleSave();
    },
    [scheduleSave],
  );

  /**
   * Toggle an MCQ option race-free (functional update): single-select replaces,
   * multi-select adds/removes. Avoids stale-closure loss on rapid clicks.
   */
  const toggleOption = useCallback(
    (questionId: string, index: number, multi: boolean) => {
      setAnswers((prev) => {
        const current = prev[questionId]?.selectedOptions ?? [];
        const next = multi
          ? current.includes(index)
            ? current.filter((i) => i !== index)
            : [...current, index]
          : [index];
        return {
          ...prev,
          [questionId]: { ...prev[questionId], selectedOptions: next },
        };
      });
      dirtyRef.current.add(questionId);
      scheduleSave();
    },
    [scheduleSave],
  );

  // --- Submit + finalize poll -----------------------------------------------

  const pollFinalize = useCallback((): void => {
    const tick = async (): Promise<void> => {
      try {
        const res = await api.exams.finalize(attemptId, token);
        if (res.gradingPending) {
          finalizeTimer.current = window.setTimeout(
            () => void tick(),
            FINALIZE_POLL_MS,
          );
        } else {
          setResult(res);
          setWarnings(res.warnings);
          setMalpractice(res.isMalpractice);
          setPhase("done");
        }
      } catch (err) {
        setError(parseApiError(err).message);
        setPhase("error");
      }
    };
    void tick();
  }, [attemptId, token]);

  const submit = useCallback(
    async (auto: boolean): Promise<void> => {
      setPhase("submitting");
      try {
        await flushSave();
      } catch {
        /* ignore — submit grades whatever is saved */
      }
      try {
        const res = await api.exams.submit(attemptId, auto, token);
        if (res.gradingPending) {
          setPhase("grading");
          pollFinalize();
        } else {
          setResult(res);
          setWarnings(res.warnings);
          setMalpractice(res.isMalpractice);
          setPhase("done");
        }
      } catch (err) {
        setError(parseApiError(err).message);
        setPhase("error");
      }
    },
    [attemptId, token, flushSave, pollFinalize],
  );

  // --- Advance --------------------------------------------------------------

  const loadSectionView = useCallback((next: AttemptSectionView) => {
    expiredRef.current = false;
    setView(next);
    setAnswers(seedAnswers(next.questions));
    setRemaining(next.sectionRemainingSeconds);
    // New section → back to its first question; reseed marks/visited from it.
    setCurrentIndex(0);
    const marked = new Set(next.markedForReview);
    markedRef.current = marked;
    marksDirtyRef.current = false;
    setMarkedForReview(marked);
    setVisited(new Set(next.markedForReview).add(next.questions[0]?.id ?? ""));
    setPhase("running");
  }, []);

  const advance = useCallback(async (): Promise<void> => {
    setPhase("advancing");
    try {
      await flushSave();
    } catch {
      /* server handles late saves; continue */
    }
    try {
      const next = await api.exams.advance(attemptId, token);
      loadSectionView(next);
    } catch (err) {
      setError(parseApiError(err).message);
      setPhase("error");
    }
  }, [attemptId, token, flushSave, loadSectionView]);

  // --- Expiry (auto-advance or auto-submit) ---------------------------------

  const handleExpire = useCallback((): void => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    if (isLastSection(view.sectionIndex, view.totalSections)) {
      void submit(true);
    } else {
      void advance();
    }
  }, [view.sectionIndex, view.totalSections, submit, advance]);
  expireFnRef.current = handleExpire;

  // --- Countdown (single interval; server value is authoritative) -----------

  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => {
      setRemaining((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, view.section.id]);

  useEffect(() => {
    if (phase === "running" && remaining <= 0 && !expiredRef.current) {
      expireFnRef.current();
    }
  }, [remaining, phase]);

  // --- One-question navigation + review flags -------------------------------

  const markVisited = useCallback((questionId: string): void => {
    setVisited((prev) =>
      prev.has(questionId) ? prev : new Set(prev).add(questionId),
    );
  }, []);

  /** Jump within the CURRENT section only (clamped to its bounds). */
  const goToIndex = useCallback(
    (i: number): void => {
      const clamped = clampIndex(i, view.questions.length);
      setCurrentIndex(clamped);
      const q = view.questions[clamped];
      if (q) markVisited(q.id);
    },
    [view.questions, markVisited],
  );

  /** Set/clear the marked-for-review flag on a question; persists via autosave. */
  const setMark = useCallback(
    (questionId: string, value: boolean): void => {
      const next = new Set(markedRef.current);
      if (value) next.add(questionId);
      else next.delete(questionId);
      markedRef.current = next;
      setMarkedForReview(next);
      marksDirtyRef.current = true;
      scheduleSave();
    },
    [scheduleSave],
  );

  /** Clear the current answer for a question (Clear Response); persists it. */
  const clearResponse = useCallback(
    (questionId: string): void => {
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
      dirtyRef.current.add(questionId);
      scheduleSave();
    },
    [scheduleSave],
  );

  // --- Warnings (anti-cheat) ------------------------------------------------

  const recordWarning = useCallback(async (): Promise<void> => {
    try {
      const res = await api.exams.warning(attemptId, token);
      setWarnings(res.warningsTriggered);
      setMalpractice(res.isMalpractice);
      // The server force-submits when warnings cross the limit; end the exam UI
      // by fetching the (already-submitted) result via the normal submit path.
      if (res.autoSubmitted) {
        void submit(true);
      }
    } catch {
      /* best-effort; ignore transient warning failures */
    }
  }, [attemptId, token, submit]);

  return {
    view,
    answers,
    remaining,
    phase,
    result,
    warnings,
    malpractice,
    saving,
    error,
    currentIndex,
    markedForReview,
    visited,
    setAnswer,
    toggleOption,
    goToIndex,
    setMark,
    clearResponse,
    flushSave,
    advance,
    submit,
    recordWarning,
  };
}
