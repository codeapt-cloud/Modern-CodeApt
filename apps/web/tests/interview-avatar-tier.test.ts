/**
 * Step 37 — PURE tests for the avatar fallback-tier selection and the UI-state →
 * mood/gesture mapping. This is the decision logic the hook relies on; it must
 * pick the right tier for a given machine and never force speech-only just for
 * reduced motion.
 */
import {
  degradeTier,
  resolveAvatarOverride,
  selectAvatarTier,
  type AvatarCapabilities,
} from "../src/lib/avatar/capabilities.js";
import { avatarExpressionFor } from "../src/lib/avatar/avatar-state.js";
import {
  estimateSpeechMs,
} from "../src/lib/avatar/talkinghead-controller.js";
import { describe, expect, it } from "vitest";

const caps = (over: Partial<AvatarCapabilities> = {}): AvatarCapabilities => ({
  webgl2: true,
  moduleWorkers: true,
  webgpu: true,
  reducedMotion: false,
  saveData: false,
  ...over,
});

describe("selectAvatarTier — lab-machine default is 3d-basic; neural is opt-in", () => {
  it("DEFAULT (neural off): capable machine → 3d-basic (avatar + browser voice)", () => {
    // Even with WebGPU, we do NOT pull the 300 MB neural model by default.
    expect(selectAvatarTier(caps()).tier).toBe("3d-basic");
    expect(selectAvatarTier(caps()).motion).toBe(true);
  });

  it("the typical lab machine (no WebGPU) → 3d-basic", () => {
    expect(selectAvatarTier(caps({ webgpu: false })).tier).toBe("3d-basic");
  });

  it("neural OPTED IN → 3d-neural (works on WASM too)", () => {
    expect(selectAvatarTier(caps({ webgpu: false }), { neural: "on" }).tier).toBe("3d-neural");
    expect(selectAvatarTier(caps(), { neural: "on" }).tier).toBe("3d-neural");
  });

  it("neural AUTO → 3d-neural only with WebGPU, else 3d-basic", () => {
    expect(selectAvatarTier(caps({ webgpu: true }), { neural: "auto" }).tier).toBe("3d-neural");
    expect(selectAvatarTier(caps({ webgpu: false }), { neural: "auto" }).tier).toBe("3d-basic");
  });

  it("no module workers → 3d-basic even if neural requested (worker can't start)", () => {
    expect(selectAvatarTier(caps({ moduleWorkers: false }), { neural: "on" }).tier).toBe("3d-basic");
  });

  it("DATA SAVER (the only connection hard-skip) → speech-only", () => {
    // effectiveType is NOT consulted anymore — a slow link is caught by measured
    // abort at download time, not a rolling guess here. Only saveData hard-skips.
    expect(selectAvatarTier(caps({ saveData: true })).tier).toBe("speech-only");
  });

  it("a plain (even '3g') connection still ATTEMPTS the avatar (3d-basic)", () => {
    // No slowConnection field exists to suppress it — the GLB fetch measures reality.
    expect(selectAvatarTier(caps()).tier).toBe("3d-basic");
  });

  it("no WebGL2 → speech-only (guaranteed floor)", () => {
    expect(selectAvatarTier(caps({ webgl2: false })).tier).toBe("speech-only");
  });

  it("avatar disabled by the viewer → speech-only regardless of hardware", () => {
    expect(selectAvatarTier(caps(), { avatarEnabled: false }).tier).toBe("speech-only");
  });

  it("reduced motion does NOT drop the tier — only stills the avatar", () => {
    const c = selectAvatarTier(caps({ reducedMotion: true }));
    expect(c.motion).toBe(false);
    expect(c.tier).toBe("3d-basic");
  });
});

describe("override — force the avatar for judging (bypasses gates + rate-abort)", () => {
  it("override 'on' forces 3d-basic even with data saver, and marks forced", () => {
    const c = selectAvatarTier(caps({ saveData: true }), { override: "on" });
    expect(c.tier).toBe("3d-basic");
    expect(c.forced).toBe(true);
  });

  it("override 'neural' forces neural (with a worker)", () => {
    expect(selectAvatarTier(caps({ webgpu: false }), { override: "neural" }).tier).toBe("3d-neural");
    expect(selectAvatarTier(caps({ moduleWorkers: false }), { override: "neural" }).tier).toBe(
      "3d-basic",
    );
  });

  it("override 'off' forces speech-only; but override can't conjure WebGL2", () => {
    expect(selectAvatarTier(caps(), { override: "off" }).tier).toBe("speech-only");
    expect(selectAvatarTier(caps({ webgl2: false }), { override: "on" }).tier).toBe("speech-only");
  });

  it("resolveAvatarOverride reads the query param, then storage, else auto", () => {
    expect(resolveAvatarOverride("?avatar=on")).toBe("on");
    expect(resolveAvatarOverride("?avatar=neural")).toBe("neural");
    expect(resolveAvatarOverride("?avatar=off")).toBe("off");
    expect(resolveAvatarOverride("?x=1")).toBe("auto");
    expect(resolveAvatarOverride("", { getItem: () => "on" })).toBe("on");
    expect(resolveAvatarOverride("", { getItem: () => null })).toBe("auto");
  });
});

describe("degradeTier — runtime step-down", () => {
  it("3d-neural → 3d-basic → speech-only", () => {
    expect(degradeTier("3d-neural")).toBe("3d-basic");
    expect(degradeTier("3d-basic")).toBe("speech-only");
    expect(degradeTier("speech-only")).toBe("speech-only");
  });
});

describe("avatarExpressionFor — the four states → mood/gesture", () => {
  it("maps each state to a professional mood, camera-facing except thinking", () => {
    expect(avatarExpressionFor("speaking")).toEqual({ mood: "happy", gesture: null, lookAtCamera: true });
    expect(avatarExpressionFor("listening")).toEqual({ mood: "neutral", gesture: null, lookAtCamera: true });
    // Thinking glances away only WITH motion.
    expect(avatarExpressionFor("thinking", { motion: true }).lookAtCamera).toBe(false);
    expect(avatarExpressionFor("idle").lookAtCamera).toBe(true);
  });

  it("reduced motion keeps the avatar still and camera-facing (no look-away, no gesture)", () => {
    const thinking = avatarExpressionFor("thinking", { motion: false });
    expect(thinking.lookAtCamera).toBe(true); // no deliberate glance-away
    for (const s of ["idle", "speaking", "listening", "thinking"] as const) {
      expect(avatarExpressionFor(s, { motion: false }).gesture).toBeNull();
    }
  });
});

describe("estimateSpeechMs", () => {
  it("scales with word count and has a floor", () => {
    expect(estimateSpeechMs("")).toBeGreaterThanOrEqual(700);
    const short = estimateSpeechMs("hello there");
    const long = estimateSpeechMs(Array.from({ length: 60 }, () => "word").join(" "));
    expect(long).toBeGreaterThan(short);
  });
});
