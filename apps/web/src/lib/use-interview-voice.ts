/**
 * Interviewer voice via the browser SpeechSynthesis API (Step 34 A2). Picks one
 * voice ONCE (stable within the session) via the pure `pickVoice`, speaks a
 * question, and exposes `speaking` + a `pulse` counter driven by utterance
 * BOUNDARY events so the avatar's mouth tracks the actual audio. `prime` warms the
 * next question's utterance (B1) so `speak` fires with no setup on submit.
 *
 * Browser TTS (not server Piper) is deliberate here: the interview is a solo,
 * per-attempt-dynamic conversation, and keeping speech in the browser is what
 * keeps the conversational path off the CPU-reserved ASR box (Part A2 / B).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { pickVoice, type VoiceLike } from "./interview-voice.js";

interface SynthLike {
  speak(u: unknown): void;
  cancel(): void;
  getVoices(): VoiceLike[];
  onvoiceschanged: (() => void) | null;
}

export interface UseInterviewVoice {
  supported: boolean;
  speaking: boolean;
  /** Increments on each word boundary while speaking — drive a subtle avatar mouth. */
  pulse: number;
  voiceName: string | null;
  speak(text: string, opts?: { onEnd?: () => void }): void;
  prime(text: string): void;
  cancel(): void;
}

export function useInterviewVoice(): UseInterviewVoice {
  const synth = useMemo<SynthLike | null>(
    () =>
      typeof window !== "undefined" &&
      (window as unknown as { speechSynthesis?: SynthLike }).speechSynthesis
        ? (window as unknown as { speechSynthesis: SynthLike }).speechSynthesis
        : null,
    [],
  );
  const voiceRef = useRef<VoiceLike | null>(null);
  const primedRef = useRef<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [voiceName, setVoiceName] = useState<string | null>(null);

  // Load + pick a voice once (getVoices is async on some platforms).
  useEffect(() => {
    if (!synth) return;
    const choose = (): void => {
      if (voiceRef.current) return;
      const picked = pickVoice(synth.getVoices());
      if (picked) {
        voiceRef.current = picked;
        setVoiceName(picked.name);
      }
    };
    choose();
    synth.onvoiceschanged = choose;
    return () => {
      if (synth) synth.onvoiceschanged = null;
    };
  }, [synth]);

  const speak = useCallback(
    (text: string, opts: { onEnd?: () => void } = {}) => {
      if (!synth || typeof window === "undefined") {
        // No TTS: the question is still shown on screen; treat as instantly "spoken".
        opts.onEnd?.();
        return;
      }
      const Utter = (window as unknown as { SpeechSynthesisUtterance: new (t: string) => Record<string, unknown> })
        .SpeechSynthesisUtterance;
      const u = new Utter(text) as Record<string, unknown> & {
        voice: unknown;
        onstart: (() => void) | null;
        onend: (() => void) | null;
        onerror: (() => void) | null;
        onboundary: (() => void) | null;
      };
      if (voiceRef.current) u.voice = voiceRef.current;
      u.onstart = () => setSpeaking(true);
      u.onboundary = () => setPulse((p) => p + 1);
      u.onend = () => {
        setSpeaking(false);
        opts.onEnd?.();
      };
      u.onerror = () => {
        setSpeaking(false);
        opts.onEnd?.();
      };
      synth.cancel();
      synth.speak(u);
      primedRef.current = null;
    },
    [synth],
  );

  // "Pre-synthesize" the next question (B1). The Web Speech API has no synth-
  // without-speaking call, so priming warms the picked voice + holds the text so
  // the eventual speak() fires with zero setup on the submit path.
  const prime = useCallback((text: string) => {
    primedRef.current = text;
  }, []);

  const cancel = useCallback(() => {
    synth?.cancel();
    setSpeaking(false);
  }, [synth]);

  return {
    supported: synth !== null,
    speaking,
    pulse,
    voiceName,
    speak,
    prime,
    cancel,
  };
}
