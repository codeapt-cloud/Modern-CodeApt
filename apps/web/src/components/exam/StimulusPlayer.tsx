/**
 * Comprehension audio stimulus (Communication module, Section D). Renders the
 * hosted passage and RECORDS each play server-side (api.exams.stimulusPlay).
 *
 * Honesty note: the audio lives at a hosted URL the browser must hold to play
 * it, so a play cap cannot be cryptographically enforced. We therefore record
 * every play and, once the intended limit is reached, remove the player and
 * show that plays are used up — the count is the source of truth, not a
 * pretend-lock. `playLimit === 0` means unlimited.
 */
import { Headphones } from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/api-client.js";

export function StimulusPlayer({
  attemptId,
  sectionId,
  token,
  audioUrl,
  playLimit,
  initialPlaysUsed,
}: {
  attemptId: string;
  sectionId: string;
  token: string | null;
  audioUrl: string;
  playLimit: number;
  initialPlaysUsed: number;
}) {
  const [playsUsed, setPlaysUsed] = useState(initialPlaysUsed);
  const [exhausted, setExhausted] = useState(
    playLimit > 0 && initialPlaysUsed >= playLimit,
  );
  const [recording, setRecording] = useState(false);

  const onPlay = async (): Promise<void> => {
    if (recording) return;
    setRecording(true);
    try {
      const res = await api.exams.stimulusPlay(
        attemptId,
        sectionId,
        token ?? undefined,
      );
      setPlaysUsed(res.playsUsed);
      setExhausted(res.exhausted);
    } catch {
      // Recording is best-effort; never block the candidate on a failed count.
    } finally {
      setRecording(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-subtle bg-surface-raised p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-ink">
        <Headphones className="h-4 w-4 text-ink-muted" />
        Listening passage
        {playLimit > 0 ? (
          <span className="ml-auto text-xs font-normal text-ink-muted">
            {Math.min(playsUsed, playLimit)} / {playLimit} play
            {playLimit === 1 ? "" : "s"} used
          </span>
        ) : (
          <span className="ml-auto text-xs font-normal text-ink-muted">
            {playsUsed} play{playsUsed === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {exhausted ? (
        <p className="text-sm text-ink-muted">
          You have used all {playLimit} allowed play{playLimit === 1 ? "" : "s"}
          . Answer the questions from what you heard.
        </p>
      ) : (
        <audio
          controls
          preload="none"
          src={audioUrl}
          onPlay={() => void onPlay()}
          className="w-full"
        >
          Your browser does not support audio playback.
        </audio>
      )}
    </div>
  );
}
