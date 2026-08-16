/**
 * Format an enrollment's `expiresAt` into a short learner-facing label + a
 * severity for badge coloring. Null = lifetime access (no badge).
 */
export interface ExpiryLabel {
  text: string;
  /** "warning" when the window is closing soon, else "neutral". */
  tone: "neutral" | "warning";
  /** Full date for a tooltip / secondary display. */
  date: string;
}

export function formatExpiry(expiresAt: string | null): ExpiryLabel | null {
  if (!expiresAt) return null;
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return null;

  const date = end.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const msLeft = end.getTime() - Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil(msLeft / dayMs);

  if (msLeft <= 0) return { text: "Access expired", tone: "warning", date };
  if (daysLeft <= 1) return { text: "Expires today", tone: "warning", date };
  if (daysLeft <= 30)
    return { text: `${daysLeft} days left`, tone: "warning", date };
  return { text: `Access until ${date}`, tone: "neutral", date };
}
