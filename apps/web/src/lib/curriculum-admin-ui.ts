/**
 * Small view-layer helpers for curriculum admin authoring: rupee↔paise for the
 * price inputs, and turning the backend's DELETE_BLOCKED 409 into something an
 * admin can read and act on.
 */
import { PAISE_PER_RUPEE, TopicType, paiseToRupees } from "@codeapt/shared";

import type { ApiErrorShape } from "./api-client.js";

/** Human label for a topic type (title-cased). */
export function topicTypeLabel(t: TopicType): string {
  switch (t) {
    case TopicType.TEXT:
      return "Text";
    case TopicType.VIDEO:
      return "Video";
    case TopicType.QUIZ:
      return "Quiz";
    case TopicType.EXAM:
      return "Exam";
    case TopicType.ESSAY:
      return "Essay";
    default:
      return t;
  }
}

/** Rupees (as typed in a number input) → integer paise for the API. */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees <= 0) return 0;
  return Math.round(rupees * PAISE_PER_RUPEE);
}

/** Integer paise → a rupee number suitable for pre-filling a number input. */
export function paiseToRupeeInput(paise: number): number {
  return paiseToRupees(paise);
}

/**
 * The DELETE_BLOCKED details payload: a map of blocker name → count, e.g.
 * `{ modules: 2, enrollments: 40 }`.
 */
export type Blockers = Record<string, number>;

/** Pull `error.details.blockers` from a parsed DELETE_BLOCKED error, else null. */
export function blockersFromError(parsed: ApiErrorShape): Blockers | null {
  if (parsed.code !== "DELETE_BLOCKED") return null;
  const details = parsed.details;
  if (!details || typeof details !== "object" || !("blockers" in details)) {
    return null;
  }
  const raw = (details as { blockers?: unknown }).blockers;
  if (!raw || typeof raw !== "object") return null;
  const out: Blockers = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && v > 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Blocker keys that represent CONTENT the admin can remove from this UI
 * (delete the child rows first). Everything else (enrolled students, orders,
 * coupons, submissions, attempts) is external data handled elsewhere.
 */
const CONTENT_BLOCKERS = new Set(["subjects", "modules", "topics"]);

/** Pluralize-friendly label for a blocker line, e.g. `2 modules`, `1 module`. */
export function blockerLine(name: string, count: number): string {
  // Keys are already human-ish ("modules", "quiz submissions"). Singularize a
  // trailing "s" when the count is 1 (best-effort; good enough for these keys).
  const label = count === 1 && name.endsWith("s") ? name.slice(0, -1) : name;
  return `${count} ${label}`;
}

/** Actionable guidance derived from which blockers are content vs external. */
export function blockerGuidance(blockers: Blockers): string {
  const keys = Object.keys(blockers);
  const content = keys.filter((k) => CONTENT_BLOCKERS.has(k));
  const external = keys.filter((k) => !CONTENT_BLOCKERS.has(k));
  const parts: string[] = [];
  if (content.length > 0) {
    parts.push(`Remove its ${content.join(" and ")} first.`);
  }
  if (external.length > 0) {
    parts.push(
      `Enrolled students, orders, and other records (${external.join(
        ", ",
      )}) must be handled separately — they can't be deleted here.`,
    );
  }
  return parts.join(" ");
}
