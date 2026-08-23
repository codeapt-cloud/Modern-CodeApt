/**
 * SpeakingItemType → renderer registry, mirroring the game renderer-registry.
 * The shell stays item-agnostic: it looks a definition up by the item's type and
 * hands the renderer the contract props, reading only `capture` to choose the
 * capture mechanism. All eleven types are registered; several share a renderer
 * (their differences are authored copy, not code). A missing type surfaces a
 * calm shell fallback rather than crashing — hence the `Partial`.
 *
 * Adding a type = one component (only if its presentation/capture is new) + one
 * line here. No shell or contract change.
 */
import { SpeakingItemType } from "@codeapt/shared";

import type { SpeakingItemDefinition } from "./renderer-contract.js";
import { DictationRenderer } from "./renderers/DictationRenderer.js";
import { ListenSpeakRenderer } from "./renderers/ListenSpeakRenderer.js";
import { ReadAloudRenderer } from "./renderers/ReadAloudRenderer.js";

const audio = (Renderer: SpeakingItemDefinition["Renderer"]): SpeakingItemDefinition => ({
  Renderer,
  capture: "audio",
});

export const SPEAKING_RENDERERS: Partial<
  Record<SpeakingItemType, SpeakingItemDefinition>
> = {
  [SpeakingItemType.READ_ALOUD]: audio(ReadAloudRenderer),
  [SpeakingItemType.REPEAT]: audio(ListenSpeakRenderer),
  [SpeakingItemType.SHORT_ANSWER]: audio(ListenSpeakRenderer),
  [SpeakingItemType.SENTENCE_BUILD]: audio(ListenSpeakRenderer),
  [SpeakingItemType.CONVERSATION]: audio(ListenSpeakRenderer),
  [SpeakingItemType.PASSAGE_QUESTION]: audio(ListenSpeakRenderer),
  [SpeakingItemType.FILL_MISSING_WORD]: audio(ListenSpeakRenderer),
  [SpeakingItemType.ERROR_CORRECT]: audio(ListenSpeakRenderer),
  [SpeakingItemType.STORY_RETELL]: audio(ListenSpeakRenderer),
  [SpeakingItemType.OPEN_TOPIC]: audio(ListenSpeakRenderer),
  // dictation is TYPED — the one divergent capture mode.
  [SpeakingItemType.DICTATION]: { Renderer: DictationRenderer, capture: "text" },
};

export function getSpeakingItemDefinition(
  itemType: SpeakingItemType,
): SpeakingItemDefinition | undefined {
  return SPEAKING_RENDERERS[itemType];
}
