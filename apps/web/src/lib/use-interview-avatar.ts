/**
 * Interview avatar orchestration hook (Step 37; corrected 37.2). Owns the fallback
 * CHAIN, the NON-BLOCKING lazy load, and a `speak`/`cancel`/`setUiState` surface the
 * runner uses in place of the old SpeechSynthesis-only `useInterviewVoice`.
 *
 * 37.2 corrections:
 *  1. We no longer trust `navigator.connection.effectiveType` (a rolling estimate a
 *     recent burst — e.g. the MediaPipe download — drags to "3g"). We START the GLB
 *     download and ABORT it only if the MEASURED rate is genuinely too slow
 *     (glb-loader.ts). Only explicit data-saver hard-skips.
 *  2. The decision is VISIBLE: `status`/`statusText` say exactly what happened
 *     (loading %, skipped — slow, unavailable — no WebGL2 / file not found).
 *  3. An OVERRIDE (?avatar=on|neural|off, or localStorage) forces the tier so the
 *     avatar can always be seen for judging; a forced load never rate-aborts.
 *
 * NON-BLOCKING: `ready` is true immediately — the greeting speaks via
 * SpeechSynthesis with the static SVG showing; the 3D avatar (and, if opted in,
 * the neural voice) stream in the background and upgrade in place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  detectAvatarCapabilities,
  resolveAvatarOverride,
  selectAvatarTier,
  type AvatarTier,
  type NeuralPolicy,
} from "./avatar/capabilities.js";
import type { AvatarUiState } from "./avatar/avatar-state.js";
import { fetchGlbObjectUrl, type GlbFailReason } from "./avatar/glb-loader.js";
import type { AvatarController } from "./avatar/talkinghead-controller.js";
import { useInterviewVoice } from "./use-interview-voice.js";

const AVATAR_GLB_URL = "/avatar/mpfb.glb";

function estimateSpeechMs(text: string): number {
  const words = (text.trim().match(/\S+/g) ?? []).length;
  return Math.max(700, Math.round((words / 165) * 60_000));
}

/** Visible avatar state — never silent. */
export type AvatarStatus =
  | "loading"
  | "ready"
  | "off"
  | "unavailable-browser"
  | "unavailable-asset"
  | "skipped-datasaver"
  | "skipped-slow"
  | "failed";

function statusTextFor(status: AvatarStatus, progress: number): string {
  switch (status) {
    case "loading":
      return `3D avatar loading… ${Math.round(progress * 100)}%`;
    case "unavailable-browser":
      return "3D avatar unavailable in this browser";
    case "unavailable-asset":
      return "3D avatar unavailable — model not found (deploy the avatar file)";
    case "skipped-datasaver":
      return "3D avatar skipped — data saver is on";
    case "skipped-slow":
      return "3D avatar skipped — connection too slow";
    case "failed":
      return "3D avatar failed to load — using the simple avatar";
    case "off":
    case "ready":
    default:
      return "";
  }
}

export interface UseInterviewAvatar {
  speak(text: string, opts?: { onEnd?: () => void }): void;
  cancel(): void;
  prime(text: string): void;
  speaking: boolean;
  tier: AvatarTier;
  ready: boolean;
  loading: boolean;
  progress: number;
  avatarVisible: boolean;
  neuralActive: boolean;
  failed: boolean;
  is3d: boolean;
  motion: boolean;
  /** Machine-readable avatar state (never silent). */
  status: AvatarStatus;
  /** Human-readable line for the UI. "" when nothing to say. */
  statusText: string;
  preload(): void;
  attach(el: HTMLElement | null): void;
  setUiState(state: AvatarUiState): void;
}

export function useInterviewAvatar(enabled = true, neural: NeuralPolicy = "off"): UseInterviewAvatar {
  const voice = useInterviewVoice();
  const choice = useMemo(() => {
    const caps =
      typeof window === "undefined"
        ? { webgl2: false, moduleWorkers: false, webgpu: false, reducedMotion: false, saveData: false }
        : detectAvatarCapabilities(window);
    const override = resolveAvatarOverride();
    return selectAvatarTier(caps, { avatarEnabled: enabled, neural, override });
  }, [enabled, neural]);

  const initialStatus: AvatarStatus =
    choice.tier !== "speech-only"
      ? "loading"
      : choice.reason.includes("WebGL2")
        ? "unavailable-browser"
        : choice.reason.includes("data saver")
          ? "skipped-datasaver"
          : "off";

  const [tier] = useState<AvatarTier>(choice.tier);
  const [progress, setProgress] = useState(0);
  const [avatarVisible, setAvatarVisible] = useState(false);
  const [neuralActive, setNeuralActive] = useState(false);
  const [status, setStatus] = useState<AvatarStatus>(initialStatus);
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
    if (choice.tier === "speech-only") return; // status already set; SS is ready
    const container = ensureContainer();
    if (!container) {
      setStatus("failed");
      return;
    }
    setStatus("loading");
    void (async () => {
      // 1. MEASURED GLB fetch (never blocks the interview; aborts if truly slow).
      let objectUrl: string;
      try {
        const res = await fetchGlbObjectUrl(AVATAR_GLB_URL, {
          forced: choice.forced,
          onProgress: (loaded, total) => {
            if (total) setProgress(Math.min(1, loaded / total));
          },
        });
        objectUrl = res.objectUrl;
      } catch (e) {
        const reason = (e as { reason?: GlbFailReason })?.reason;
        setStatus(
          reason === "too-slow"
            ? "skipped-slow"
            : reason === "not-found" || reason === "not-glb"
              ? "unavailable-asset"
              : "failed",
        );
        return;
      }
      // 2. Build the avatar from the in-memory GLB (no re-download).
      try {
        const { createAvatarController } = await import("./avatar/talkinghead-controller.js");
        const controller = await createAvatarController(container, {
          motion: choice.motion,
          glbUrl: objectUrl,
        });
        if (!controller) {
          setStatus("failed");
          return;
        }
        controllerRef.current = controller;
        controller.setState(uiStateRef.current, choice.motion);
        avatarVisibleRef.current = true;
        setAvatarVisible(true);
        setStatus("ready");
        if (choice.tier === "3d-neural") {
          void controller.enableNeural().then((ok) => ok && setNeuralActive(true));
        }
      } catch {
        setStatus("failed");
      }
    })();
  }, [choice.tier, choice.motion, choice.forced, ensureContainer]);

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
      if (ctrl && ctrl.neuralReady()) {
        void ctrl.speakNeural(text).then(done, done);
        return;
      }
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

  const failed =
    status === "failed" || status === "unavailable-asset" || status === "skipped-slow";

  return {
    speak,
    cancel,
    prime: voice.prime,
    speaking,
    tier,
    ready: true,
    loading: status === "loading",
    progress,
    avatarVisible,
    neuralActive,
    failed,
    is3d: tier !== "speech-only" && status !== "failed" && status !== "unavailable-asset" && status !== "skipped-slow",
    motion: choice.motion,
    status,
    statusText: statusTextFor(status, progress),
    preload,
    attach,
    setUiState,
  };
}
