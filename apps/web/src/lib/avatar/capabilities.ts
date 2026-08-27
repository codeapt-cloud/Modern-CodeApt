/**
 * PURE avatar capability detection + fallback-tier selection (Step 37; corrected
 * 37.2). Deployment target: college lab machines — often older Chrome, integrated
 * graphics, NO WebGPU, on shared campus wifi.
 *
 * 37.2 correction: `navigator.connection.effectiveType` is a ROLLING estimate that
 * a burst of requests (e.g. the MediaPipe WASM download moments earlier) drags down
 * — it wrongly reported "3g" on a fine connection and silently suppressed the
 * avatar. We NO LONGER gate on effectiveType. We only hard-skip on `saveData` (an
 * explicit user choice); otherwise we START the GLB download and ABORT it if the
 * MEASURED rate is genuinely too slow (see glb-loader.ts) — measuring the real
 * download instead of trusting a guess. An override (?avatar=on/neural/off) forces
 * the decision so the avatar can always be seen for judging.
 *
 * Tiers: 3d-neural (TalkingHead + HeadTTS Kokoro, opt-in), 3d-basic (TalkingHead +
 * browser voice + estimated lip-sync — the default), speech-only (static SVG + SS).
 */
export type AvatarTier = "3d-neural" | "3d-basic" | "speech-only";

/** Whether/how to attempt the neural Kokoro voice. Default is OPT-IN ("off"). */
export type NeuralPolicy = "auto" | "on" | "off";

/** Explicit override (query param / setting): force the tier regardless of caps. */
export type AvatarOverride = "auto" | "on" | "neural" | "off";

export interface AvatarCapabilities {
  readonly webgl2: boolean;
  readonly moduleWorkers: boolean;
  readonly webgpu: boolean;
  readonly reducedMotion: boolean;
  /** The user turned on data-saver — the ONLY connection signal we hard-skip on. */
  readonly saveData: boolean;
}

export interface AvatarTierChoice {
  readonly tier: AvatarTier;
  readonly motion: boolean;
  /** True when an override forced this — the GLB download must NOT rate-abort. */
  readonly forced: boolean;
  readonly reason: string;
}

export function selectAvatarTier(
  caps: AvatarCapabilities,
  opts: { avatarEnabled?: boolean; neural?: NeuralPolicy; override?: AvatarOverride } = {},
): AvatarTierChoice {
  const avatarEnabled = opts.avatarEnabled ?? true;
  const neural = opts.neural ?? "off";
  const override = opts.override ?? "auto";
  const motion = !caps.reducedMotion;

  if (!avatarEnabled || override === "off") {
    return { tier: "speech-only", motion, forced: false, reason: "avatar turned off" };
  }
  if (!caps.webgl2) {
    return { tier: "speech-only", motion, forced: false, reason: "this browser has no WebGL2" };
  }
  // Forced overrides bypass the connection gate (and the rate-abort downstream).
  if (override === "on") {
    return { tier: "3d-basic", motion, forced: true, reason: "forced on (override)" };
  }
  if (override === "neural") {
    return caps.moduleWorkers
      ? { tier: "3d-neural", motion, forced: true, reason: "forced neural (override)" }
      : { tier: "3d-basic", motion, forced: true, reason: "forced (no worker → browser voice)" };
  }
  // Auto: only data-saver hard-skips; a slow link is caught by measured abort.
  if (caps.saveData) {
    return { tier: "speech-only", motion, forced: false, reason: "data saver is on" };
  }
  const neuralWanted =
    caps.moduleWorkers && (neural === "on" || (neural === "auto" && caps.webgpu));
  if (neuralWanted) {
    return {
      tier: "3d-neural",
      motion,
      forced: false,
      reason: neural === "on" ? "neural opted in" : "neural auto (WebGPU)",
    };
  }
  return { tier: "3d-basic", motion, forced: false, reason: "3D avatar + browser voice" };
}

export function degradeTier(tier: AvatarTier): AvatarTier {
  return tier === "3d-neural" ? "3d-basic" : "speech-only";
}

/** Resolve the override from a query string then localStorage; default "auto". */
export function resolveAvatarOverride(
  search?: string,
  storage?: Pick<Storage, "getItem"> | null,
): AvatarOverride {
  const read = (): string => {
    try {
      const s =
        search ?? (typeof window !== "undefined" ? window.location.search : "");
      const qp = new URLSearchParams(s).get("avatar");
      if (qp) return qp;
      const store =
        storage ?? (typeof window !== "undefined" ? window.localStorage : null);
      return store?.getItem?.("codeapt.avatar") ?? "";
    } catch {
      return "";
    }
  };
  const v = read().toLowerCase();
  if (v === "on" || v === "3d" || v === "basic") return "on";
  if (v === "neural") return "neural";
  if (v === "off") return "off";
  return "auto";
}

/** Detect capabilities from the live browser (DOM). Guarded so it never throws. */
export function detectAvatarCapabilities(win: Window = window): AvatarCapabilities {
  const webgl2 = (() => {
    try {
      const c = win.document.createElement("canvas");
      return !!c.getContext("webgl2");
    } catch {
      return false;
    }
  })();
  const moduleWorkers = (() => {
    try {
      void win;
      return typeof Worker !== "undefined" && typeof Blob !== "undefined";
    } catch {
      return false;
    }
  })();
  const webgpu = (() => {
    try {
      return "gpu" in win.navigator && !!(win.navigator as { gpu?: unknown }).gpu;
    } catch {
      return false;
    }
  })();
  const reducedMotion = (() => {
    try {
      return (
        typeof win.matchMedia === "function" &&
        win.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch {
      return false;
    }
  })();
  const saveData = (() => {
    try {
      const conn = (win.navigator as { connection?: { saveData?: boolean } }).connection;
      return !!conn?.saveData;
    } catch {
      return false;
    }
  })();
  return { webgl2, moduleWorkers, webgpu, reducedMotion, saveData };
}
