/**
 * Interview avatar orchestration hook (Step 37, retuned 37.1 for lab machines).
 * Owns the fallback CHAIN, the NON-BLOCKING lazy load, and a `speak`/`cancel`/
 * `setUiState` surface the runner uses in place of the old SpeechSynthesis-only
 * `useInterviewVoice`. Lives in InterviewSession (like the camera hook).
 *
 * NON-BLOCKING is the point: question one NEVER waits on the 36.8 MB GLB or the
 * 300 MB neural model. `ready` is true immediately — the greeting speaks through
 * SpeechSynthesis with the static SVG showing, and the 3D avatar (and, if opted
 * in, the neural voice) stream in the BACKGROUND and upgrade the experience when
 * they arrive. Default tier is 3d-basic (avatar + browser voice + estimated
 * lip-sync); neural Kokoro is opt-in. Greetings/acknowledgements are spoken
 * through THIS `speak`, so the Step-36 flow is preserved by whichever voice runs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  detectAvatarCapabilities,
  selectAvatarTier,
  type AvatarTier,
  type NeuralPolicy,
} from "./avatar/capabilities.js";
import type { AvatarUiState } from "./avatar/avatar-state.js";
import type { AvatarController } from "./avatar/talkinghead-controller.js";
import { useInterviewVoice } from "./use-interview-voice.js";

/** Local copy of the controller's estimate (kept here so this hook needs no static
 *  import from the lazy controller module). ~165 wpm, floored. */
function estimateSpeechMs(text: string): number {
  const words = (text.trim().match(/\S+/g) ?? []).length;
  return Math.max(700, Math.round((words / 165) * 60_000));
}

export interface UseInterviewAvatar {
  speak(text: string, opts?: { onEnd?: () => void }): void;
  cancel(): void;
  prime(text: string): void;
  speaking: boolean;
  /** The SELECTED tier (intent). May render as the static SVG until the GLB loads. */
  tier: AvatarTier;
  /** Always true — the interview never blocks on avatar assets. */
  ready: boolean;
  /** True while the GLB is still downloading in the background. */
  loading: boolean;
  progress: number;
  /** True once the 3D avatar canvas is loaded and should be shown. */
  avatarVisible: boolean;
  /** True when the neural voice has connected and is now driving speech. */
  neuralActive: boolean;
  /** True when a 3D avatar was intended but its GLB failed → static SVG. */
  failed: boolean;
  /** Whether the runner should render the 3D mount (intent). */
  is3d: boolean;
  motion: boolean;
  preload(): void;
  attach(el: HTMLElement | null): void;
  setUiState(state: AvatarUiState): void;
}

export function useInterviewAvatar(enabled = true, neural: NeuralPolicy = "off"): UseInterviewAvatar {
  const voice = useInterviewVoice();
  const choice = useMemo(() => {
    const caps =
      typeof window === "undefined"
        ? { webgl2: false, moduleWorkers: false, webgpu: false, reducedMotion: false, slowConnection: false }
        : detectAvatarCapabilities(window);
    return selectAvatarTier(caps, { avatarEnabled: enabled, neural });
  }, [enabled, neural]);

  const [tier] = useState<AvatarTier>(choice.tier);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [avatarVisible, setAvatarVisible] = useState(false);
  const [neuralActive, setNeuralActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const controllerRef = useRef<AvatarController | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const preloadStartedRef = useRef(false);
  const avatarVisibleRef = useRef(false);
  const uiStateRef = useRef<AvatarUiState>("idle");

  const ensureContainer = useCallback((): HTMLElement | null => {
    if (typeof document === "undefined") return null;
    if (!containerRef.current) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:fixed;left:-99999px;top:0;width:320px;height:320px;pointer-events:none;";
      document.body.appendChild(el);
      containerRef.current = el;
    }
    return containerRef.current;
  }, []);

  const preload = useCallback(() => {
    if (preloadStartedRef.current) return;
    preloadStartedRef.current = true;
    if (choice.tier === "speech-only") return; // nothing to load; SS is ready now
    const container = ensureContainer();
    if (!container) {
      setFailed(true);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const { createAvatarController } = await import("./avatar/talkinghead-controller.js");
        // VISUAL first (GLB). Never blocks the interview — the greeting has
        // already been (or will be) spoken via SpeechSynthesis meanwhile.
        const controller = await createAvatarController(container, {
          motion: choice.motion,
          onProgress: (p) => setProgress(p),
        });
        if (!controller) {
          setFailed(true);
          return;
        }
        controllerRef.current = controller;
        controller.setState(uiStateRef.current, choice.motion);
        avatarVisibleRef.current = true;
        setAvatarVisible(true);
        // NEURAL voice (opt-in) connects separately, in the background. It never
        // gates anything; turns start using it once it's ready.
        if (choice.tier === "3d-neural") {
          void controller.enableNeural().then((ok) => {
            if (ok) setNeuralActive(true);
          });
        }
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
        setProgress(1);
      }
    })();
  }, [choice.tier, choice.motion, ensureContainer]);

  const attach = useCallback((el: HTMLElement | null) => {
    const container = containerRef.current;
    if (!container) return;
    if (el) {
      el.appendChild(container);
      container.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    } else if (container.parentElement && container.parentElement !== document.body) {
      container.style.cssText =
        "position:fixed;left:-99999px;top:0;width:320px;height:320px;pointer-events:none;";
      document.body.appendChild(container);
    }
  }, []);

  const setUiState = useCallback(
    (state: AvatarUiState) => {
      uiStateRef.current = state;
      controllerRef.current?.setState(state, choice.motion);
    },
    [choice.motion],
  );

  const speak = useCallback(
    (text: string, opts: { onEnd?: () => void } = {}) => {
      const done = () => {
        setSpeaking(false);
        opts.onEnd?.();
      };
      setSpeaking(true);
      const ctrl = controllerRef.current;
      // Neural only once it has actually connected (never blocks; at most one
      // SpeechSynthesis→neural transition across the session, never flip-flop).
      if (ctrl && ctrl.neuralReady()) {
        void ctrl.speakNeural(text).then(done, done);
        return;
      }
      // Browser voice (the default). If the 3D avatar is up, animate its mouth
      // from the estimated timings while SpeechSynthesis plays the audio.
      if (ctrl && avatarVisibleRef.current) ctrl.speakEstimated(text, estimateSpeechMs(text));
      voice.speak(text, { onEnd: done });
    },
    [voice],
  );

  const cancel = useCallback(() => {
    setSpeaking(false);
    try {
      controllerRef.current?.stop();
    } catch {
      /* no-op */
    }
    voice.cancel();
  }, [voice]);

  useEffect(() => {
    return () => {
      try {
        controllerRef.current?.dispose();
      } catch {
        /* no-op */
      }
      controllerRef.current = null;
      const c = containerRef.current;
      if (c && c.parentElement) c.parentElement.removeChild(c);
      containerRef.current = null;
    };
  }, []);

  return {
    speak,
    cancel,
    prime: voice.prime,
    speaking,
    tier,
    ready: true, // the interview never waits on avatar assets
    loading,
    progress,
    avatarVisible,
    neuralActive,
    failed,
    is3d: tier !== "speech-only" && !failed,
    motion: choice.motion,
    preload,
    attach,
    setUiState,
  };
}
