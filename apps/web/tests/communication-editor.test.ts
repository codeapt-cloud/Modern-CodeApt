/**
 * Step 23 C1 — the composite editor DEGRADES on a failing picker instead of
 * blanking. The web suite runs in node (no DOM), so we test the pure resilience
 * fold the page uses: one rejected list records a reason and leaves the others
 * intact. The canonical case is an authoring-but-not-speaking college whose
 * speaking list 403s — the operator can still compose exam + essay parts.
 */
import { describe, expect, it } from "vitest";

import {
  settleArtifactLists,
  type ArtifactLite,
} from "../src/lib/communication-editor.js";

const ok = (
  items: ArtifactLite[],
): PromiseSettledResult<{ items: ArtifactLite[] }> => ({
  status: "fulfilled",
  value: { items },
});
const fail = (
  message: string,
): PromiseSettledResult<{ items: ArtifactLite[] }> => ({
  status: "rejected",
  reason: new Error(message),
});
const parse = (r: unknown): string =>
  r instanceof Error ? r.message : "Something went wrong";

const A = (id: string): ArtifactLite => ({
  id,
  title: `T-${id}`,
  isPublished: true,
});

describe("settleArtifactLists (composite editor degrade)", () => {
  it("a failing speaking list leaves exams + essays intact and records the reason", () => {
    const out = settleArtifactLists(
      [ok([A("e1")]), ok([A("s1")]), fail("You don't have speaking access")],
      parse,
    );
    // The two healthy pickers still work…
    expect(out.exams).toHaveLength(1);
    expect(out.essays).toHaveLength(1);
    // …and the speaking picker is empty WITH a reason (not a silent blank).
    expect(out.speaking).toHaveLength(0);
    expect(out.pickerErrors.speaking).toBe("You don't have speaking access");
    expect(out.pickerErrors.exam).toBeNull();
    expect(out.pickerErrors.essay).toBeNull();
  });

  it("all three healthy → no picker errors", () => {
    const out = settleArtifactLists([ok([A("a")]), ok([A("b")]), ok([A("c")])], parse);
    expect(out.pickerErrors).toEqual({ exam: null, essay: null, speaking: null });
    expect(out.exams[0]!.id).toBe("a");
  });

  it("multiple failures are recorded independently; survivors still load", () => {
    const out = settleArtifactLists(
      [fail("exam down"), ok([A("es")]), fail("speaking down")],
      parse,
    );
    expect(out.exams).toHaveLength(0);
    expect(out.essays).toHaveLength(1);
    expect(out.speaking).toHaveLength(0);
    expect(out.pickerErrors.exam).toBe("exam down");
    expect(out.pickerErrors.speaking).toBe("speaking down");
    expect(out.pickerErrors.essay).toBeNull();
  });
});
