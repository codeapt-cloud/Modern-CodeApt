/**
 * Pure decision helpers for essay autosave + recovery. No React, no I/O — the
 * hook (`use-essay-draft`) and the composer fold these decisions into their
 * side effects, and these functions are unit-tested independently.
 *
 * Autosave is a snapshot buffer only: it never submits, grades, or consumes an
 * attempt. These helpers just decide WHEN a save is worthwhile, WHETHER a
 * fetched draft should replace the current editor text, and the label to show.
 */

export type DraftSaveState = "idle" | "saving" | "saved" | "error";

/**
 * Whether the current text is worth autosaving: non-trivial (some non-blank
 * content) AND changed since the last successful save. Blank/whitespace-only
 * text is never persisted, so an emptied editor doesn't churn snapshots.
 */
export function shouldAutosaveDraft(
  content: string,
  lastSaved: string | null,
): boolean {
  if (content.trim().length === 0) return false;
  return content !== lastSaved;
}

/**
 * Whether a fetched draft should be restored into the editor. Only recover when
 * the draft actually has content AND the editor is still empty — recovery must
 * never clobber text the student has already started typing.
 */
export function shouldRecoverDraft(
  draftContent: string,
  currentContent: string,
): boolean {
  return draftContent.trim().length > 0 && currentContent.trim().length === 0;
}

/** Human label for the autosave indicator (mirrors the exam runner's cue). */
export function draftStatusLabel(state: DraftSaveState): string {
  switch (state) {
    case "saving":
      return "Saving draft…";
    case "saved":
      return "Draft saved";
    case "error":
      return "Couldn’t save draft — keep writing";
    default:
      return "";
  }
}
