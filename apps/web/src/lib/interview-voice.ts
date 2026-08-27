/**
 * PURE voice selection for the interviewer avatar's browser TTS (Step 34 A2).
 * `speechSynthesis.getVoices()` varies wildly by platform, so we pick from a
 * PREFERRED list (natural English voices common across Chrome/Edge/Safari) with a
 * sane fallback, and the runner picks ONCE and keeps it stable for the session.
 * DOM-free so it unit-tests; the runner passes the real `getVoices()` array in.
 *
 * NOTE: the speaking module deliberately uses SERVER Piper TTS to give every
 * student the SAME voice for graded prompts. The interview is a SOLO practice
 * session with per-attempt dynamic questions, so a per-device browser voice is
 * fine here — and it is the only way to keep the conversational path off the
 * CPU-reserved ASR box (Step 34 Part A2 / B).
 */
export interface VoiceLike {
  readonly name: string;
  readonly lang: string;
  readonly default?: boolean;
  readonly localService?: boolean;
}

/** Preferred natural English voices, best-first. Matched case-insensitively as a
 *  substring so "…Aria Online (Natural)…" and "Google UK English Female" both hit. */
export const PREFERRED_VOICES: readonly string[] = [
  "Google UK English Female",
  "Google US English",
  "Microsoft Aria",
  "Microsoft Jenny",
  "Samantha",
  "Microsoft Zira",
  "Daniel",
];

function isEnglish(v: VoiceLike): boolean {
  return /^en(-|_|$)/i.test(v.lang);
}

/**
 * Choose one voice deterministically: the first PREFERRED name found among the
 * English voices, else the first en-US/en-GB voice, else any English voice, else
 * the platform default, else the first voice, else null (no voices at all).
 */
export function pickVoice(
  voices: readonly VoiceLike[],
  opts: { preferred?: readonly string[] } = {},
): VoiceLike | null {
  if (voices.length === 0) return null;
  const preferred = opts.preferred ?? PREFERRED_VOICES;
  const english = voices.filter(isEnglish);

  for (const name of preferred) {
    const needle = name.toLowerCase();
    const hit = english.find((v) => v.name.toLowerCase().includes(needle));
    if (hit) return hit;
  }
  const usGb = english.find((v) => /^en(-|_)(us|gb)/i.test(v.lang));
  if (usGb) return usGb;
  if (english.length > 0) return english[0]!;
  const dflt = voices.find((v) => v.default);
  return dflt ?? voices[0]!;
}
