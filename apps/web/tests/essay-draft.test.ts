/**
 * Pure essay-autosave decision helpers. These drive WHEN the composer persists
 * a snapshot, WHETHER a recovered draft replaces the editor text, and the
 * status label shown — kept free of React/DOM so they're exhaustively testable.
 */
import { describe, expect, it } from "vitest";

import {
  draftStatusLabel,
  shouldAutosaveDraft,
  shouldRecoverDraft,
} from "../src/lib/essay-draft.js";

describe("shouldAutosaveDraft", () => {
  it("saves when content is non-trivial and changed since last save", () => {
    expect(shouldAutosaveDraft("Hello world", null)).toBe(true);
    expect(shouldAutosaveDraft("Hello world", "Hello")).toBe(true);
  });

  it("does NOT save unchanged content (no churn on identical text)", () => {
    expect(shouldAutosaveDraft("Hello world", "Hello world")).toBe(false);
  });

  it("never saves blank / whitespace-only content", () => {
    expect(shouldAutosaveDraft("", null)).toBe(false);
    expect(shouldAutosaveDraft("   \n\t ", null)).toBe(false);
    // Even if it "changed" from a prior save, an emptied editor isn't persisted.
    expect(shouldAutosaveDraft("   ", "Hello world")).toBe(false);
  });
});

describe("shouldRecoverDraft", () => {
  it("recovers a non-empty draft into an empty editor", () => {
    expect(shouldRecoverDraft("recovered text", "")).toBe(true);
    expect(shouldRecoverDraft("recovered text", "   ")).toBe(true);
  });

  it("never clobbers text the student has already started typing", () => {
    expect(shouldRecoverDraft("recovered text", "already typing")).toBe(false);
  });

  it("does not recover an empty draft", () => {
    expect(shouldRecoverDraft("", "")).toBe(false);
    expect(shouldRecoverDraft("  ", "")).toBe(false);
  });
});

describe("draftStatusLabel", () => {
  it("maps each save state to a human label", () => {
    expect(draftStatusLabel("saving")).toBe("Saving draft…");
    expect(draftStatusLabel("saved")).toBe("Draft saved");
    expect(draftStatusLabel("error")).toContain("Couldn’t save draft");
    expect(draftStatusLabel("idle")).toBe("");
  });
});
