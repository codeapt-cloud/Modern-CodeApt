/**
 * English dictionary for the deterministic essay spelling check.
 *
 * `an-array-of-english-words` is a pure-JS JSON word list (~275k words, no
 * native deps) — appropriate for the worker's Node runtime. It ships as a raw
 * JSON array (package `main` is `index.json`), so we load it via `createRequire`
 * ONCE at module scope and build a Set for O(1) membership. `isKnownWord` is the
 * injected predicate the shared engine's `scoreSpelling` uses.
 *
 * tsup keeps this package external (only `@codeapt/shared` is bundled), so the
 * JSON resolves from node_modules at runtime; vitest/tsx resolve it directly.
 */
import { createRequire } from "node:module";

const load = createRequire(import.meta.url);
const WORDS = load("an-array-of-english-words") as string[];
const DICTIONARY = new Set<string>(WORDS);

/** True when `word` (already lowercased by the caller) is in the dictionary. */
export function isKnownWord(word: string): boolean {
  return DICTIONARY.has(word);
}

/** Word count — exposed for a sanity check/test that the list actually loaded. */
export const DICTIONARY_SIZE = DICTIONARY.size;
