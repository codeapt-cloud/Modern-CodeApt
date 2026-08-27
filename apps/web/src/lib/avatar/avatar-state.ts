/**
 * PURE mapping from the interview's four UI states to TalkingHead's mood/gesture
 * API (Step 37). We drive the AVATAR'S expression only — this is never any
 * inference about the candidate (hard constraint). Moods are kept to a modest,
 * professional subset (neutral / happy) so the interviewer reads as attentive, not
 * theatrical. Under reduced motion, gestures and camera glances are suppressed.
 */
export type AvatarUiState = "idle" | "speaking" | "listening" | "thinking";

/** TalkingHead-facing expression for a UI state. */
export interface AvatarExpression {
  /** A TalkingHead mood name (its `setMood`). */
  readonly mood: "neutral" | "happy";
  /** A TalkingHead gesture name (`playGesture`), or null for none. */
  readonly gesture: string | null;
  /** Whether the avatar should hold eye contact with the camera. */
  readonly lookAtCamera: boolean;
}

/**
 * Map a UI state to the avatar's expression. `motion` false (reduced motion)
 * strips gestures and the deliberate "look away while thinking", leaving a calm,
 * still, camera-facing avatar.
 */
export function avatarExpressionFor(
  state: AvatarUiState,
  opts: { motion: boolean } = { motion: true },
): AvatarExpression {
  const motion = opts.motion;
  switch (state) {
    case "speaking":
      // Engaged and looking at the candidate while asking.
      return { mood: "happy", gesture: null, lookAtCamera: true };
    case "listening":
      // Attentive: neutral, holding eye contact.
      return { mood: "neutral", gesture: null, lookAtCamera: true };
    case "thinking":
      // Considering the answer — glance away briefly (only when motion is on).
      return { mood: "neutral", gesture: null, lookAtCamera: !motion };
    case "idle":
    default:
      return { mood: "neutral", gesture: null, lookAtCamera: true };
  }
}
