/**
 * LAZY TalkingHead + HeadTTS controller (Step 37, retuned 37.1). Everything heavy
 * is reached ONLY via dynamic import from the avatar hook, so Three.js, TalkingHead,
 * HeadTTS and the Kokoro worker never enter the main bundle or any other page.
 *
 * The VISUAL (TalkingHead + the 36.8 MB GLB) and the NEURAL VOICE (HeadTTS/Kokoro,
 * 300 MB+ at defaults) are loaded INDEPENDENTLY so neither blocks the other and
 * neither blocks question one — the hook starts speaking with SpeechSynthesis
 * immediately and only routes through neural once (and if) it has connected.
 *
 * Two speech paths on the SAME avatar:
 *   - NEURAL: HeadTTS (Kokoro) synthesises audio AND phoneme-timestamped Oculus
 *     visemes → `head.speakAudio(...)` — real lip-sync (opt-in, background-loaded).
 *   - ESTIMATED (the default): the browser's SpeechSynthesis produces the AUDIO
 *     (owned by the hook) while this drives the MOUTH from TalkingHead's text→viseme
 *     estimation over a silent buffer — visible lip movement, no 300 MB download.
 *     (HeadAudio-style worklet detection can't run on SpeechSynthesis: the Web
 *     Speech API exposes no audio stream to analyse, so estimation is the path.)
 *
 * Mood/gesture is the AVATAR'S expression only, never candidate inference. No camera
 * frame or video is touched here.
 */
import { avatarExpressionFor, type AvatarUiState } from "./avatar-state.js";

/** Self-hosted CC0 (MPFB) avatar path. The hook fetches this itself (measured +
 *  abortable) and hands the resulting object URL to `createAvatarController`. */
export const AVATAR_URL = "/avatar/mpfb.glb";
const NEURAL_VOICE = "am_fenrir"; // a natural English Kokoro voice

interface TalkingHeadLike {
  showAvatar(avatar: Record<string, unknown>, onprogress?: (e: unknown) => void): Promise<void>;
  speakAudio(audio: Record<string, unknown>, opt?: Record<string, unknown>): void;
  setMood(mood: string): void;
  playGesture(name: string, dur?: number): void;
  lookAtCamera(t: number): void;
  lookAhead(t: number): void;
  stopSpeaking?(): void;
  start?(): void;
  stop?(): void;
  dispose?(): void;
}
interface HeadTTSLike {
  connect(): Promise<void>;
  synthesize(data: Record<string, unknown>): Promise<Array<{ type: string; data: Record<string, unknown> }>>;
  disconnect?(): void;
  close?(): void;
}

export interface AvatarController {
  /** True once the neural voice has connected (Kokoro loaded). */
  neuralReady(): boolean;
  /** Connect the neural voice IN THE BACKGROUND. Resolves true on success. */
  enableNeural(): Promise<boolean>;
  /** NEURAL speak (owns audio + lip-sync). Resolves when playback ends. */
  speakNeural(text: string): Promise<void>;
  /** ESTIMATED mouth motion over `durationMs` (audio played by the caller). */
  speakEstimated(text: string, durationMs: number): void;
  stop(): void;
  setState(state: AvatarUiState, motion: boolean): void;
  dispose(): void;
}

/** Rough spoken duration (ms) for a text at ~165 wpm — for the estimated tier. */
export function estimateSpeechMs(text: string): number {
  const words = (text.trim().match(/\S+/g) ?? []).length;
  return Math.max(700, Math.round((words / 165) * 60_000));
}

/** Build word timings spread evenly across a duration (estimated-tier lip-sync). */
export function estimatedWordTimings(text: string, durationMs: number): {
  words: string[];
  wtimes: number[];
  wdurations: number[];
} {
  const words = text.trim().match(/\S+/g) ?? [];
  const per = words.length > 0 ? durationMs / words.length : durationMs;
  const wtimes = words.map((_, i) => Math.round(i * per));
  const wdurations = words.map(() => Math.round(per * 0.9));
  return { words, wtimes, wdurations };
}

/**
 * Create + mount the 3D avatar VISUAL (TalkingHead + GLB) into `container`. The
 * neural voice is NOT connected here — call `enableNeural()` for that (background).
 * Returns null when even the 3D avatar can't initialise → the hook stays on the
 * static SVG + SpeechSynthesis. `onProgress` reports 0..1 during the GLB load.
 */
export async function createAvatarController(
  container: HTMLElement,
  opts: { motion: boolean; glbUrl?: string },
): Promise<AvatarController | null> {
  const { motion, glbUrl } = opts;
  let head: TalkingHeadLike;
  try {
    // Import BOTH the engine AND the English lip-sync module as static specifiers
    // so Vite BUNDLES them. TalkingHead would otherwise load lipsync via a COMPUTED
    // `import(path + 'lipsync-en.mjs')` at runtime (path defaults to "./"), which
    // resolves against the hashed /assets/ chunk → /assets/lipsync-en.mjs → the SPA
    // 404 (index.html) → the whole avatar dies. lipsync-en.mjs is self-contained
    // ESM exporting `LipsyncEn`, so we wire it ourselves and pass lipsyncModules:[]
    // so TalkingHead never fires that runtime import.
    const [mod, lip] = (await Promise.all([
      import("@met4citizen/talkinghead"),
      import("@met4citizen/talkinghead/modules/lipsync-en.mjs"),
    ])) as unknown as [
      { TalkingHead: new (el: HTMLElement, o?: Record<string, unknown>) => TalkingHeadLike },
      { LipsyncEn: new () => unknown },
    ];
    head = new mod.TalkingHead(container, {
      lipsyncModules: [], // don't let TalkingHead runtime-import lipsync (see above)
      lipsyncLang: "en",
      cameraView: "upper", // head-and-shoulders, like a video call
      cameraRotateEnable: false,
      avatarMute: false,
      modelFPS: motion ? 30 : 24,
    });
    // Wire the bundled lip-sync processor directly (ctor set `this.lipsync = {}`).
    (head as unknown as { lipsync: Record<string, unknown> }).lipsync.en = new lip.LipsyncEn();
    console.info("[avatar] controller: TalkingHead constructed, loading GLB …");
    // The hook has already fetched the GLB (measured + validated) into an object
    // URL; TalkingHead loads it from memory (no re-download). Falls back to the
    // path if none was supplied.
    await head.showAvatar({
      url: glbUrl ?? AVATAR_URL,
      body: "M",
      lipsyncLang: "en",
      avatarMood: "neutral",
    });
    console.info("[avatar] controller: showAvatar done — 3D avatar ready.");
  } catch (e) {
    // Do NOT swallow: this is the throw that leaves the interview on the SVG.
    console.error("[avatar] controller: TalkingHead/three/GLB init threw:", e);
    return null; // 3D avatar failed → caller stays on the static SVG
  }

  let tts: HeadTTSLike | null = null;

  const silentCtx: AudioContext | null = (() => {
    try {
      const Ctx =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      return Ctx ? new Ctx() : null;
    } catch {
      return null;
    }
  })();

  function speakEstimated(text: string, durationMs: number): void {
    if (!silentCtx) return;
    try {
      const { words, wtimes, wdurations } = estimatedWordTimings(text, durationMs);
      const buf = silentCtx.createBuffer(1, Math.max(1, Math.round((durationMs / 1000) * 22050)), 22050);
      head.speakAudio({ audio: buf, words, wtimes, wdurations }, { isRaw: true });
    } catch (e) {
      console.warn("[avatar] estimated lip-sync failed this turn (audio still plays):", e);
    }
  }

  return {
    neuralReady: () => tts !== null,
    async enableNeural() {
      if (tts) return true;
      try {
        const ttsMod = (await import("@met4citizen/headtts")) as unknown as {
          HeadTTS: new (o: Record<string, unknown>) => HeadTTSLike;
        };
        const inst: HeadTTSLike = new ttsMod.HeadTTS({
          endpoints: ["webgpu", "wasm"],
          voices: [NEURAL_VOICE],
          languages: ["en-us"],
          // Quantized model: ~90 MB instead of the 300 MB+ fp32/q4 defaults.
          dtypeWebgpu: "q8f16",
          dtypeWasm: "q8",
          audioCtx: null,
        });
        await inst.connect();
        tts = inst;
        return true;
      } catch (e) {
        console.warn("[avatar] neural TTS (HeadTTS/Kokoro) unavailable — browser voice:", e);
        tts = null;
        return false;
      }
    },
    async speakNeural(text: string) {
      if (!tts) {
        speakEstimated(text, estimateSpeechMs(text));
        return;
      }
      let endMs = estimateSpeechMs(text);
      try {
        const messages = await tts.synthesize({ input: text, language: "en-us", voice: NEURAL_VOICE });
        let last = 0;
        for (const m of messages) {
          if (m.type !== "audio") continue;
          head.speakAudio(m.data, {});
          const vt = (m.data.vtimes as number[]) ?? (m.data.wtimes as number[]) ?? [];
          const vd = (m.data.vdurations as number[]) ?? (m.data.wdurations as number[]) ?? [];
          if (vt.length) last = Math.max(last, (vt[vt.length - 1] ?? 0) + (vd[vd.length - 1] ?? 0));
        }
        if (last > 0) endMs = last;
      } catch (e) {
        console.warn("[avatar] neural synth failed for this turn — estimated mouth:", e);
        speakEstimated(text, endMs);
      }
      await new Promise<void>((r) => setTimeout(r, endMs + 250));
    },
    speakEstimated,
    stop() {
      try {
        head.stopSpeaking?.();
      } catch {
        /* no-op */
      }
    },
    setState(state: AvatarUiState, m: boolean) {
      const e = avatarExpressionFor(state, { motion: m });
      try {
        head.setMood(e.mood);
      } catch {
        /* mood name rejected — ignore */
      }
      try {
        if (e.lookAtCamera) head.lookAtCamera(600);
        else head.lookAhead(600);
      } catch {
        /* optional */
      }
      try {
        if (m && e.gesture) head.playGesture(e.gesture, 2);
      } catch {
        /* optional */
      }
    },
    dispose() {
      try {
        head.stop?.();
        head.dispose?.();
      } catch {
        /* no-op */
      }
      try {
        tts?.disconnect?.();
        tts?.close?.();
      } catch {
        /* no-op */
      }
      try {
        void silentCtx?.close();
      } catch {
        /* no-op */
      }
    },
  };
}
