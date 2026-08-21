/**
 * Loads the YouTube IFrame Player API once (singleton) and hands back the `YT`
 * namespace. We use the JS API — rather than a bare embed — so we can strip
 * YouTube's own chrome (share / "Watch on YouTube" / context menu) and drive a
 * fully custom control bar, which is what stops students lifting the link.
 *
 * NOTE: this injects a <script> from youtube.com. If the site is served with a
 * strict CSP, `script-src` must allow https://www.youtube.com (frame-src
 * already allows the nocookie host for the existing embed).
 */
export interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  destroy(): void;
}

interface YtPlayerEvent {
  target: YtPlayer;
  data: number;
}

export interface YtNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: YtPlayerEvent) => void;
        onStateChange?: (e: YtPlayerEvent) => void;
        onError?: (e: YtPlayerEvent) => void;
      };
    },
  ) => YtPlayer;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YtNamespace> | null = null;

export function loadYouTubeIframeApi(): Promise<YtNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("No window"));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YtNamespace>((resolve, reject) => {
    // Chain any pre-existing ready handler so we don't clobber it.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube API loaded without a Player"));
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () => reject(new Error("Failed to load the YouTube API"));
    document.head.appendChild(tag);
  });
  return apiPromise;
}

/** seconds → "m:ss" / "h:mm:ss". */
export function formatMediaTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
