/**
 * The Speaking item render contract — the seam between the runner SHELL and a
 * per-item-type renderer, mirroring the game system's renderer-contract. The
 * shell owns the mic pre-flight, both clocks (prep + recording window), prompt-
 * audio playback with play-limit enforcement, the upload, the submit, progress,
 * and proctoring. A renderer owns ONLY the item's STIMULUS presentation and, for
 * the one divergent capture mode, its capture widget.
 *
 * The eleven item types fall into four INTERACTION FAMILIES (listen / read /
 * prep / type) but the shell never type-switches: it reads two data-driven
 * signals instead —
 *   - `capture` (registry metadata): "audio" → the shell renders its own record
 *     control (uniform across every spoken item); "text" → the renderer owns the
 *     capture (dictation's text box), exactly as the game contract's optional
 *     `probe` channel lets door_key diverge with no contract change.
 *   - `view.prepSeconds` / `view.stimulusAudioUrl|promptAudioUrl` (item data):
 *     the shell runs a prep countdown when prepSeconds>0 and plays prompt audio
 *     when the item carries a URL. Nothing type-specific lives in the shell.
 *
 * A future item-type author writes ONE renderer (stimulus presentation; plus a
 * capture widget only if it is a NEW capture mode) and adds ONE registry line
 * with its `capture`. No shell or contract change.
 */
import type { SpeakingItemView } from "@codeapt/shared";
import type { ComponentType } from "react";

import type { RecorderState } from "../../lib/audio-recorder-machine.js";

/** How a renderer captures the response. The shell wires the matching mechanism. */
export type SpeakingCapture = "audio" | "text";

/**
 * The recorder handle the shell hands the runner for an AUDIO item. The shell
 * owns the MediaRecorder, the window clock, the upload, and the submit; these
 * read-only values drive the shared record affordance. (Present on the props for
 * symmetry; audio items are captured by the shell's own control, so a renderer
 * rarely needs it — it exists for a renderer that wants a bespoke affordance.)
 */
export interface SpeakingRecorderHandle {
  readonly state: RecorderState;
  readonly level: number;
  readonly remainingSeconds: number;
  readonly start: () => void;
  readonly stop: () => void;
}

export interface SpeakingRendererProps {
  readonly view: SpeakingItemView;
  /** Item is over / read-only — stop accepting input. */
  readonly locked: boolean;
  /** Present for AUDIO items (the shell owns the recorder). */
  readonly recorder?: SpeakingRecorderHandle;
  /** TEXT capture (dictation): submit the typed text; the shell does the rest. */
  readonly submitText?: (text: string) => void;
}

export type SpeakingRenderer = ComponentType<SpeakingRendererProps>;

/**
 * Registry entry: the renderer plus the ONE piece of metadata the shell needs to
 * sequence the item without a type switch — how the response is captured.
 */
export interface SpeakingItemDefinition {
  readonly Renderer: SpeakingRenderer;
  readonly capture: SpeakingCapture;
}
