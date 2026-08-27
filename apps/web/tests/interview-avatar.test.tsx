// @vitest-environment jsdom
/**
 * Step 37 (corrected 37.2) — component/hook tests for the avatar driver. Exercise
 * the WIRING: never blocks question one; default tier is 3d-basic; the decision is
 * always VISIBLE via `status` (loading / skipped-slow / unavailable-asset /
 * unavailable-browser); a slow or undeployed GLB degrades to audio-only with a
 * clear status; the override forces the avatar. TalkingHead/HeadTTS + the network
 * are mocked; live rendering is a take-one check.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  caps: { webgl2: false, moduleWorkers: false, webgpu: false, reducedMotion: false, saveData: false },
  controllerResult: null as unknown,
  glbError: null as string | null,
  neuralCalls: [] as string[],
  estimatedCalls: [] as string[],
}));

vi.mock("../src/lib/avatar/capabilities.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, detectAvatarCapabilities: () => h.caps };
});
vi.mock("../src/lib/avatar/glb-loader.js", () => ({
  fetchGlbObjectUrl: async () => {
    if (h.glbError) throw { reason: h.glbError };
    return { objectUrl: "blob:mock", bytes: 100 };
  },
}));
vi.mock("../src/lib/avatar/talkinghead-controller.js", () => ({
  createAvatarController: async () => h.controllerResult,
  estimateSpeechMs: () => 500,
  AVATAR_URL: "/avatar/mpfb.glb",
}));

import { useInterviewAvatar } from "../src/lib/use-interview-avatar.js";

const spoken: string[] = [];
beforeEach(() => {
  spoken.length = 0;
  h.neuralCalls.length = 0;
  h.estimatedCalls.length = 0;
  h.controllerResult = null;
  h.glbError = null;
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  class Utter {
    text: string;
    voice: unknown = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onboundary: (() => void) | null = null;
    constructor(t: string) {
      this.text = t;
    }
  }
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = Utter;
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    getVoices: () => [],
    onvoiceschanged: null,
    cancel: () => undefined,
    speak: (u: { text: string; onend?: (() => void) | null }) => {
      spoken.push(u.text);
      setTimeout(() => u.onend?.(), 0);
    },
  };
});
afterEach(() => vi.clearAllMocks());

const makeController = (neuralConnects = false) => {
  let neural = false;
  return {
    neuralReady: () => neural,
    enableNeural: async () => {
      neural = neuralConnects;
      return neuralConnects;
    },
    speakNeural: (t: string) => {
      h.neuralCalls.push(t);
      return Promise.resolve();
    },
    speakEstimated: (t: string) => h.estimatedCalls.push(t),
    stop: vi.fn(),
    setState: vi.fn(),
    dispose: vi.fn(),
  };
};

const capable = () => ({ webgl2: true, moduleWorkers: true, webgpu: true, reducedMotion: false, saveData: false });

describe("never blocks question one", () => {
  it("ready immediately; greeting spoken via SpeechSynthesis before the GLB loads", async () => {
    h.caps = capable();
    h.controllerResult = makeController(false);
    const { result } = renderHook(() => useInterviewAvatar(true));
    expect(result.current.ready).toBe(true);
    expect(result.current.tier).toBe("3d-basic");
    act(() => result.current.preload());
    const onEnd = vi.fn();
    act(() => result.current.speak("Hello Vinay.", { onEnd }));
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(spoken).toContain("Hello Vinay.");
  });
});

describe("3d-basic default — visible status + estimated mouth once loaded", () => {
  it("loads (status ready), shows the avatar, animates the mouth, uses browser voice", async () => {
    h.caps = capable();
    h.controllerResult = makeController(false);
    const { result } = renderHook(() => useInterviewAvatar(true));
    expect(result.current.status).toBe("loading");
    expect(result.current.statusText).toMatch(/loading/i);
    await act(async () => result.current.preload());
    await waitFor(() => expect(result.current.avatarVisible).toBe(true));
    expect(result.current.status).toBe("ready");

    const onEnd = vi.fn();
    act(() => result.current.speak("Tell me about AAMS.", { onEnd }));
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(spoken).toContain("Tell me about AAMS.");
    expect(h.estimatedCalls).toContain("Tell me about AAMS.");
    expect(h.neuralCalls).toHaveLength(0);
  });
});

describe("neural opt-in", () => {
  it("neural:'on' + connected → greeting spoken by the neural driver", async () => {
    h.caps = capable();
    h.controllerResult = makeController(true);
    const { result } = renderHook(() => useInterviewAvatar(true, "on"));
    expect(result.current.tier).toBe("3d-neural");
    await act(async () => result.current.preload());
    await waitFor(() => expect(result.current.neuralActive).toBe(true));
    const onEnd = vi.fn();
    act(() => result.current.speak("Hello Vinay", { onEnd }));
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(h.neuralCalls).toContain("Hello Vinay");
  });
});

describe("the decision is always visible; the interview still completes", () => {
  it("GLB too slow → status skipped-slow, is3d false, still speaks", async () => {
    h.caps = capable();
    h.glbError = "too-slow";
    const { result } = renderHook(() => useInterviewAvatar(true));
    await act(async () => result.current.preload());
    await waitFor(() => expect(result.current.status).toBe("skipped-slow"));
    expect(result.current.is3d).toBe(false);
    expect(result.current.statusText).toMatch(/too slow/i);
    const onEnd = vi.fn();
    act(() => result.current.speak("First question.", { onEnd }));
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(spoken).toContain("First question.");
  });

  it("GLB not deployed (404 / index.html) → status unavailable-asset", async () => {
    h.caps = capable();
    h.glbError = "not-found";
    const { result } = renderHook(() => useInterviewAvatar(true));
    await act(async () => result.current.preload());
    await waitFor(() => expect(result.current.status).toBe("unavailable-asset"));
    expect(result.current.statusText).toMatch(/not found|deploy/i);
    expect(result.current.is3d).toBe(false);
  });

  it("controller build fails → status failed, still speaks", async () => {
    h.caps = capable();
    h.controllerResult = null;
    const { result } = renderHook(() => useInterviewAvatar(true));
    await act(async () => result.current.preload());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    const onEnd = vi.fn();
    act(() => result.current.speak("Q.", { onEnd }));
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(spoken).toContain("Q.");
  });

  it("data saver → speech-only with a clear status", () => {
    h.caps = { ...capable(), saveData: true };
    const { result } = renderHook(() => useInterviewAvatar(true));
    expect(result.current.tier).toBe("speech-only");
    expect(result.current.status).toBe("skipped-datasaver");
  });

  it("no WebGL2 → speech-only, status unavailable-browser", () => {
    h.caps = { ...capable(), webgl2: false };
    const { result } = renderHook(() => useInterviewAvatar(true));
    expect(result.current.status).toBe("unavailable-browser");
  });
});

describe("override forces the avatar for judging", () => {
  it("localStorage override 'on' forces 3d-basic even with data saver", () => {
    window.localStorage.setItem("codeapt.avatar", "on");
    h.caps = { ...capable(), saveData: true };
    const { result } = renderHook(() => useInterviewAvatar(true));
    expect(result.current.tier).toBe("3d-basic");
    expect(result.current.is3d).toBe(true);
  });
});

describe("accessibility", () => {
  it("reduced motion keeps the tier but disables motion", () => {
    h.caps = { ...capable(), reducedMotion: true };
    const { result } = renderHook(() => useInterviewAvatar(true));
    expect(result.current.tier).toBe("3d-basic");
    expect(result.current.motion).toBe(false);
  });
  it("avatar disabled → speech-only", () => {
    h.caps = capable();
    const { result } = renderHook(() => useInterviewAvatar(false));
    expect(result.current.tier).toBe("speech-only");
  });
});
