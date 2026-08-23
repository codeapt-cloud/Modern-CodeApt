/**
 * The spoken-response family that is NOT read-aloud: repeat, short_answer,
 * sentence_build, conversation, passage_question, fill_missing_word,
 * error_correct, story_retell, and open_topic. The stimulus (if any) is AUDIO —
 * played by the shell's prompt-audio player (with play-limit) — so the reference
 * text is deliberately WITHHELD (the view already blanks it). This renderer just
 * presents the authored instruction; the shell owns audio, prep, and the record
 * control. One renderer covers the whole family — its differences are authored
 * copy (promptText), not code.
 */
import type { SpeakingRendererProps } from "../renderer-contract.js";

export function ListenSpeakRenderer({ view }: SpeakingRendererProps): JSX.Element {
  const hasAudio = Boolean(view.stimulusAudioUrl || view.promptAudioUrl);
  return (
    <div className="space-y-2">
      <p className="text-base text-ink">
        {view.promptText || "Listen, then record your response."}
      </p>
      {hasAudio ? (
        <p className="text-sm text-ink-muted">
          Play the audio above, then record your answer within the time shown.
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          Record your answer within the time shown.
        </p>
      )}
    </div>
  );
}
