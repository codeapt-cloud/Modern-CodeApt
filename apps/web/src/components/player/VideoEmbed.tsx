/**
 * Locked-down YouTube player for course videos. Uses the YouTube IFrame Player
 * API with all native chrome removed and the iframe made non-interactive behind
 * a click-shield, so students can't reach the "Watch on YouTube" link, the
 * share/context menus, or the logo — i.e. can't lift the link FROM the player.
 * All playback is driven through our own controls (play/pause, ±10s seek + a
 * scrubber, volume, playback speed, fullscreen).
 *
 * Honest limit: the video id is unavoidably present in the embed URL (DOM) and
 * the media loads from googlevideo.com (Network tab) — this hardens the player
 * UI, it does not make the id cryptographically secret.
 */
import {
  Gauge,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  formatMediaTime,
  loadYouTubeIframeApi,
  type YtNamespace,
  type YtPlayer,
} from "../../lib/youtube-iframe.js";

const SEEK_STEP = 10; // seconds for the skip buttons

export function VideoEmbed({
  videoId,
  title,
}: {
  videoId: string;
  title: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const ytRef = useRef<YtNamespace | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [rates, setRates] = useState<number[]>([0.5, 1, 1.5, 2]);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [isFs, setIsFs] = useState(false);

  // Build the player once per video id.
  useEffect(() => {
    let cancelled = false;
    let poll: number | undefined;
    setReady(false);
    setFailed(false);

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;
        ytRef.current = YT;
        playerRef.current = new YT.Player(mountRef.current, {
          videoId,
          width: "100%",
          height: "100%",
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            controls: 0,
            modestbranding: 1,
            rel: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              setReady(true);
              setDuration(e.target.getDuration());
              setVolume(e.target.getVolume());
              setMuted(e.target.isMuted());
              setRate(e.target.getPlaybackRate());
              try {
                const avail = e.target.getAvailablePlaybackRates();
                if (avail.length > 0) setRates(avail);
              } catch {
                /* keep defaults */
              }
              poll = window.setInterval(() => {
                const p = playerRef.current;
                if (!p) return;
                setCurrent(p.getCurrentTime());
                const d = p.getDuration();
                if (d) setDuration(d);
              }, 400);
            },
            onStateChange: (e) => {
              if (cancelled || !ytRef.current) return;
              setPlaying(e.data === ytRef.current.PlayerState.PLAYING);
            },
            onError: () => {
              if (!cancelled) setFailed(true);
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      try {
        playerRef.current?.destroy();
      } catch {
        /* already gone */
      }
      playerRef.current = null;
    };
  }, [videoId]);

  // Track fullscreen state so the button icon reflects reality.
  useEffect(() => {
    const onFsChange = (): void =>
      setIsFs(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const player = (): YtPlayer | null => playerRef.current;

  const togglePlay = (): void => {
    const p = player();
    if (!p) return;
    if (playing) p.pauseVideo();
    else p.playVideo();
  };

  const skip = (delta: number): void => {
    const p = player();
    if (!p) return;
    const next = Math.min(
      Math.max(0, p.getCurrentTime() + delta),
      p.getDuration() || Infinity,
    );
    p.seekTo(next, true);
    setCurrent(next);
  };

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const p = player();
    if (!p) return;
    const t = Number(e.target.value);
    p.seekTo(t, true);
    setCurrent(t);
  };

  const onVolume = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const p = player();
    if (!p) return;
    const v = Number(e.target.value);
    p.setVolume(v);
    setVolume(v);
    if (v === 0) {
      p.mute();
      setMuted(true);
    } else if (muted) {
      p.unMute();
      setMuted(false);
    }
  };

  const toggleMute = (): void => {
    const p = player();
    if (!p) return;
    if (muted) {
      p.unMute();
      setMuted(false);
      if (volume === 0) {
        p.setVolume(50);
        setVolume(50);
      }
    } else {
      p.mute();
      setMuted(true);
    }
  };

  const setSpeed = (r: number): void => {
    player()?.setPlaybackRate(r);
    setRate(r);
    setSpeedOpen(false);
  };

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement === shellRef.current) {
      void document.exitFullscreen?.();
    } else {
      void shellRef.current?.requestFullscreen?.();
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-subtle bg-black">
      <div
        ref={shellRef}
        className="relative aspect-video select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* The API replaces this node with the iframe; keep it non-interactive
            so no click ever reaches YouTube's own UI. */}
        <div className="pointer-events-none absolute inset-0 [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full">
          <div ref={mountRef} />
        </div>

        {failed ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/80">
            This protected video player couldn&apos;t load. Refresh the page, or
            contact support if it persists.
          </div>
        ) : (
          <>
            {/* Click-shield: swallows clicks (blocking YouTube UI) and doubles
                as the play/pause + double-click-fullscreen surface. */}
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play"}
              className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none"
              onClick={togglePlay}
              onDoubleClick={toggleFullscreen}
              onContextMenu={(e) => e.preventDefault()}
            />

            {!ready ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-white/70">
                Loading…
              </div>
            ) : null}

            {/* Center play affordance when paused. */}
            {ready && !playing ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <span className="rounded-full bg-black/50 p-4">
                  <Play className="h-8 w-8 fill-white text-white" />
                </span>
              </div>
            ) : null}

            {/* Control bar. */}
            <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6">
              {/* Scrubber */}
              <input
                type="range"
                aria-label="Seek"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(current, duration || 0)}
                onChange={onScrub}
                disabled={!ready}
                className="h-1 w-full cursor-pointer accent-primary"
              />
              <div className="mt-1 flex items-center gap-2 text-white">
                <button
                  type="button"
                  aria-label={playing ? "Pause" : "Play"}
                  onClick={togglePlay}
                  className="rounded p-1 hover:bg-white/10"
                >
                  {playing ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="h-5 w-5" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Back 10 seconds"
                  onClick={() => skip(-SEEK_STEP)}
                  className="rounded p-1 hover:bg-white/10"
                >
                  <RotateCcw className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label="Forward 10 seconds"
                  onClick={() => skip(SEEK_STEP)}
                  className="rounded p-1 hover:bg-white/10"
                >
                  <RotateCw className="h-5 w-5" />
                </button>

                {/* Volume */}
                <button
                  type="button"
                  aria-label={muted ? "Unmute" : "Mute"}
                  onClick={toggleMute}
                  className="rounded p-1 hover:bg-white/10"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="h-5 w-5" />
                  ) : (
                    <Volume2 className="h-5 w-5" />
                  )}
                </button>
                <input
                  type="range"
                  aria-label="Volume"
                  min={0}
                  max={100}
                  step={1}
                  value={muted ? 0 : volume}
                  onChange={onVolume}
                  className="h-1 w-20 cursor-pointer accent-primary"
                />

                <span className="ml-1 font-mono text-xs tabular-nums text-white/90">
                  {formatMediaTime(current)} / {formatMediaTime(duration)}
                </span>

                <div className="ml-auto flex items-center gap-1">
                  {/* Playback speed */}
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Playback speed"
                      onClick={() => setSpeedOpen((o) => !o)}
                      className="flex items-center gap-1 rounded p-1 text-xs hover:bg-white/10"
                    >
                      <Gauge className="h-5 w-5" /> {rate}×
                    </button>
                    {speedOpen ? (
                      <div className="absolute bottom-9 right-0 min-w-16 overflow-hidden rounded-lg bg-black/90 py-1 text-xs">
                        {rates.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setSpeed(r)}
                            className={`block w-full px-3 py-1 text-right hover:bg-white/10 ${
                              r === rate ? "text-primary" : "text-white"
                            }`}
                          >
                            {r}×
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    aria-label={isFs ? "Exit fullscreen" : "Fullscreen"}
                    onClick={toggleFullscreen}
                    className="rounded p-1 hover:bg-white/10"
                  >
                    {isFs ? (
                      <Minimize className="h-5 w-5" />
                    ) : (
                      <Maximize className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <span className="sr-only">{title}</span>
    </div>
  );
}
