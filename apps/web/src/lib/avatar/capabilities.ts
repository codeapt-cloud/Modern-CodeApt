/**
 * PURE avatar capability detection + fallback-tier selection (Step 37, retuned
 * Step 37.1 for the DEPLOYMENT TARGET: college lab machines — often older Chrome,
 * integrated graphics, NO WebGPU, on shared campus wifi).
 *
 * Two measured facts drive the policy:
 *   - the avatar GLB is 36.8 MB and the Kokoro neural model is 300 MB+ at defaults
 *     (90 MB even quantized) — far too large to BLOCK question one on;
 *   - most target machines have no WebGPU, so a neural tier would run Kokoro on
 *     WASM (slow) after a huge download.
 * So: the interview NEVER waits on avatar/model assets (the hook starts speaking
 * with SpeechSynthesis + a static avatar immediately and upgrades in the
 * background), the default tier is 3d-basic (TalkingHead avatar + SpeechSynthesis
 * + TalkingHead's text→viseme ESTIMATED lip-sync — visible mouth movement, no
 * 300 MB download), and the neural Kokoro voice is OPT-IN.
 *
 * Tiers (highest → lowest):
 *   - "3d-neural": TalkingHead + HeadTTS Kokoro — phoneme-timestamp lip-sync +
 *     neural voice. ONLY when opted in (or `neural:"auto"` on WebGPU + a fast
 *     connection). Loads in the background; the first session usually still speaks
 *     via SpeechSynthesis (Kokoro caches for later).
 *   - "3d-basic" (DEFAULT for capable machines): TalkingHead avatar + the browser
 *     voice + estimated lip-sync. Only the 36.8 MB GLB streams (in the background);
 *     the voice is instant. Visible lip movement, no neural download.
 *   - "speech-only": static SVG + SpeechSynthesis. Used on a slow connection (don't
 *     pull 36.8 MB), no WebGL2, or when the viewer disables the avatar.
 */
export type AvatarTier = "3d-neural" | "3d-basic" | "speech-only";

/** Whether/how to attempt the neural Kokoro voice. Default is OPT-IN ("off"). */
export type NeuralPolicy = "auto" | "on" | "off";

export interface AvatarCapabilities {
  readonly webgl2: boolean;
  readonly moduleWorkers: boolean;
  readonly webgpu: boolean;
  readonly reducedMotion: boolean;
  /** Connection is metered/slow (2g/3g/save-data) — skip the 36.8 MB GLB. Unknown
   *  (no NetworkInformation API) is treated as NOT slow, so capable machines on
   *  Firefox/Safari aren't needlessly downgraded. */
  readonly slowConnection: boolean;
}

export interface AvatarTierChoice {
  readonly tier: AvatarTier;
  readonly motion: boolean;
  readonly reason: string;
}

export function selectAvatarTier(
  caps: AvatarCapabilities,
  opts: { avatarEnabled?: boolean; neural?: NeuralPolicy } = {},
): AvatarTierChoice {
  const avatarEnabled = opts.avatarEnabled ?? true;
  const neural = opts.neural ?? "off"; // opt-in by default (lab-machine safe)
  const motion = !caps.reducedMotion;

  if (!avatarEnabled) {
    return { tier: "speech-only", motion, reason: "avatar disabled by the viewer" };
  }
  if (!caps.webgl2) {
    return { tier: "speech-only", motion, reason: "no WebGL2 — 3D avatar unavailable" };
  }
  if (caps.slowConnection) {
    // The 36.8 MB avatar isn't worth it on a metered/slow link — stay light.
    return { tier: "speech-only", motion, reason: "slow/metered connection — avatar skipped" };
  }
  const neuralWanted =
    caps.moduleWorkers &&
    (neural === "on" || (neural === "auto" && caps.webgpu));
  if (neuralWanted) {
    return {
      tier: "3d-neural",
      motion,
      reason:
        neural === "on"
          ? "neural voice opted in"
          : "neural auto — WebGPU + fast connection",
    };
  }
  return {
    tier: "3d-basic",
    motion,
    reason: "3D avatar + browser voice (estimated lip-sync) — the lab default",
  };
}

/** The next tier down, for runtime step-down when a tier fails to initialise. */
export function degradeTier(tier: AvatarTier): AvatarTier {
  return tier === "3d-neural" ? "3d-basic" : "speech-only";
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
  const slowConnection = (() => {
    try {
      const conn = (win.navigator as { connection?: { effectiveType?: string; saveData?: boolean } })
        .connection;
      if (!conn) return false; // unknown → assume OK
      if (conn.saveData) return true;
      const et = conn.effectiveType ?? "";
      return et === "slow-2g" || et === "2g" || et === "3g";
    } catch {
      return false;
    }
  })();
  return { webgl2, moduleWorkers, webgpu, reducedMotion, slowConnection };
}
