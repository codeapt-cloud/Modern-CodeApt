// @vitest-environment jsdom
/**
 * Step 37 (retuned 37.1) — component/hook tests for the avatar driver. Exercise the
 * WIRING: the interview speaks a greeting IMMEDIATELY (never blocks on the 36.8 MB
 * GLB or the neural model), the default tier is 3d-basic (browser voice + estimated
 * mouth), the neural voice is used only once opted in AND connected, a failed 3D
 * load still completes with audio only, and reduced motion is honoured. TalkingHead/
 * HeadTTS themselves need a GPU and are mocked; live rendering is a take-one check.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  caps: { webgl2: false, moduleWorkers: false, webgpu: false, reducedMotion: false, slowConnection: false },
  controllerResult: null as unknown,
  neuralCalls: [] as string[],
  estimatedCalls: [] as string[],
}));

vi.mock("../src/lib/avatar/capabilities.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, detectAvatarCapabilities: () => h.caps };
});
vi.mock("../src/lib/avatar/talkinghead-controller.js", () => ({
  createAvatarController: async () => h.controllerResult,
  estimateSpeechMs: () => 500,
}));

import { useInterviewAvatar } from "../src/lib/use-interview-avatar.js";

const spoken: string[] = [];
beforeEach(() => {
  spoken.length = 0;
  h.neuralCalls.length = 0;
  h.estimatedCalls.length = 0;
  h.controllerResult = null;
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

/** A fake 3D controller. `neuralConnects` decides whether enableNeural succeeds. */
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
    speakEstimated: (t: string) => {
      h.estimatedCalls.push(t);
    },
    stop: vi.fn(),
    setState: vi.fn(),
    dispose: vi.fn(),
  };
};

describe("useInterviewAvatar — never blocks question one", () => {
  it("is ready immediately and speaks the greeting via SpeechSynthesis BEFORE the avatar loads", async () => {
    h.caps = { webgl2: true, moduleWorkers: true, webgpu: false, reducedMotion: false, slowConnection: false };
    h.controllerResult = makeController(false);
    const { result } = renderHook(() => useInterviewAvatar(true));
    expect(result.current.ready).toBe(true); // immediate — no waiting on assets
    expect(result.current.tier).toBe("3d-basic");

    // Speak the greeting straight away, before preload has finished loading the GLB.
    act(() => result.current.preload());
    const onEnd = vi.fn();
    act(() => result.current.speak("Hello Vinay, thanks for joining me today.", { onEnd }));
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(spoken).toContain("Hello Vinay, thanks for joining me today."); // spoken now
  });
});

describe("useInterviewAvatar — 3d-basic default (browser voice + estimated mouth once loaded)", () => {
  it("shows the avatar after the GLB loads and animates the mouth via estimation", async () => {
    h.caps = { webgl2: true, moduleWorkers: true, webgpu: true, reducedMotion: false, slowConnection: false };
    h.controllerResult = makeController(false); // neural NOT used (opt-in, off by default)
    const { result } = renderHook(() => useInterviewAvatar(true)); // default neural "off"
    expect(result.current.tier).toBe("3d-basic");
    await act(async () => {
      result.current.preload();
    });
    await waitFor(() => expect(result.current.avatarVisible).toBe(true));

    const onEnd = vi.fn();
    act(() => result.current.speak("Tell me about AAMS.", { onEnd }));
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(spoken).toContain("Tell me about AAMS."); // browser voice
    expect(h.estimatedCalls).toContain("Tell me about AAMS."); // estimated mouth
    expect(h.neuralCalls).toHaveLength(0); // never neural by default
  });
});

describe("useInterviewAvatar — neural is opt-in and used only once connected", () => {
  it("neural:'on' + connected → greeting spoken by the neural driver", async () => {
    h.caps = { webgl2: true, moduleWorkers: true, webgpu: true, reducedMotion: false, slowConnection: false };
    h.controllerResult = makeController(true); // enableNeural succeeds
    const { result } = renderHook(() => useInterviewAvatar(true, "on"));
    expect(result.current.tier).toBe("3d-neural");
    await act(async () => {
      result.current.preload();
    });
    await waitFor(() => expect(result.current.neuralActive).toBe(true));

    const onEnd = vi.fn();
    act(() => result.current.speak("Hello Vinay", { onEnd }));
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(h.neuralCalls).toContain("Hello Vinay");
  });
});

describe("useInterviewAvatar — avatar fails to load → audio-only still completes", () => {
  it("degrades to the static avatar and still speaks", async () => {
    h.caps = { webgl2: true, moduleWorkers: true, webgpu: true, reducedMotion: false, slowConnection: false };
    h.controllerResult = null; // createAvatarController returns null (3D load failed)
    const { result } = renderHook(() => useInterviewAvatar(true));
    await act(async () => {
      result.current.preload();
    });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.is3d).toBe(false);
    expect(result.current.ready).toBe(true);

    const onEnd = vi.fn();
    act(() => result.current.speak("First question.", { onEnd }));
    await waitFor(() => expect(onEnd).toHaveBeenCalled());
    expect(spoken).toContain("First question.");
  });
});

describe("useInterviewAvatar — connection + accessibility", () => {
  it("slow connection → speech-only (no 36.8 MB pull)", () => {
    h.caps = { webgl2: true, moduleWorkers: true, webgpu: true, reducedMotion: false, slowConnection: true };
    const { result } = renderHook(() => useInterviewAvatar(true, "on"));
    expect(result.current.tier).toBe("speech-only");
    expect(result.current.is3d).toBe(false);
  });

  it("reduced motion keeps the tier but disables motion", () => {
    h.caps = { webgl2: true, moduleWorkers: true, webgpu: true, reducedMotion: true, slowConnection: false };
    const { result } = renderHook(() => useInterviewAvatar(true));
    expect(result.current.tier).toBe("3d-basic");
    expect(result.current.motion).toBe(false);
  });

  it("avatar disabled → speech-only", () => {
    h.caps = { webgl2: true, moduleWorkers: true, webgpu: true, reducedMotion: false, slowConnection: false };
    const { result } = renderHook(() => useInterviewAvatar(false));
    expect(result.current.tier).toBe("speech-only");
  });
});
