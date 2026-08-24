/**
 * Pure resilience logic for the communication composite editor (Step 23 C1).
 *
 * The editor loads three independent artifact lists (exam / essay / speaking) so
 * the operator can pick parts. These lists are settled INDEPENDENTLY: one
 * failing picker must never blank the whole editor. The canonical failure is a
 * college with `communication.authoring` but not `communication.speaking` — the
 * speaking list 403s, yet the operator can still legitimately compose exam +
 * essay parts. We DEGRADE (keep the entitlement meaning intact) rather than
 * widen the speaking listing under `authoring`.
 *
 * Extracted here (not inline in the page) because the web suite runs in node
 * with no DOM — a pure function is what we can actually test.
 */
export interface ArtifactLite {
  id: string;
  title: string;
  isPublished: boolean;
}

export type EditorPartType = "exam" | "essay" | "speaking";

export interface SettledArtifactLists {
  exams: ArtifactLite[];
  essays: ArtifactLite[];
  speaking: ArtifactLite[];
  /** Per-type reason a picker is unavailable, or null when it loaded. */
  pickerErrors: Record<EditorPartType, string | null>;
}

interface ListResponseLike {
  items: ArtifactLite[];
}

/**
 * Fold three `Promise.allSettled` results into the editor's list state. A
 * fulfilled list populates its picker; a rejected one leaves the picker EMPTY
 * and records the reason (via `parseError`) so the UI can explain it — the other
 * two are unaffected either way.
 */
export function settleArtifactLists(
  results: readonly [
    PromiseSettledResult<ListResponseLike>,
    PromiseSettledResult<ListResponseLike>,
    PromiseSettledResult<ListResponseLike>,
  ],
  parseError: (reason: unknown) => string,
): SettledArtifactLists {
  const [exR, esR, spR] = results;
  const toArtifacts = (items: readonly ArtifactLite[]): ArtifactLite[] =>
    items.map((x) => ({
      id: x.id,
      title: x.title,
      isPublished: x.isPublished,
    }));
  return {
    exams: exR.status === "fulfilled" ? toArtifacts(exR.value.items) : [],
    essays: esR.status === "fulfilled" ? toArtifacts(esR.value.items) : [],
    speaking: spR.status === "fulfilled" ? toArtifacts(spR.value.items) : [],
    pickerErrors: {
      exam: exR.status === "rejected" ? parseError(exR.reason) : null,
      essay: esR.status === "rejected" ? parseError(esR.reason) : null,
      speaking: spR.status === "rejected" ? parseError(spR.reason) : null,
    },
  };
}
