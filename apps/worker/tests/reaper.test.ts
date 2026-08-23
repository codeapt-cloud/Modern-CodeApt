/**
 * The shared attempt reaper's pure decision (shouldReapSpeaking) — no Mongo. A
 * speaking attempt is reaped only when it is past its server deadline AND still
 * has an undisclosed item; an attempt whose items are all answered is left alone
 * (only async scoring remains, which the deadline must not disturb).
 */
import { describe, expect, it } from "vitest";

import { SPEAKING_SUBMIT_GRACE_MS } from "@codeapt/shared";

import { shouldReapSpeaking } from "../src/processors/reaper.processor.js";

const NOW = new Date("2026-01-01T12:00:00Z");
// Past the deadline AND past the submit grace — only then is it reapable.
const wayPast = new Date(NOW.getTime() - SPEAKING_SUBMIT_GRACE_MS - 60_000);
// Past the deadline but still WITHIN the grace (an in-flight answer may land).
const withinGrace = new Date(NOW.getTime() - 30_000);
const future = new Date(NOW.getTime() + 60_000);

describe("shouldReapSpeaking", () => {
  it("reaps an in_progress attempt past deadline+grace with an undisclosed item", () => {
    expect(
      shouldReapSpeaking(
        { status: "in_progress", expiresAt: wayPast, currentIndex: 1, itemCount: 3 },
        NOW,
      ),
    ).toBe(true);
  });

  it("reaps a submitted-but-incomplete attempt past deadline+grace", () => {
    expect(
      shouldReapSpeaking(
        { status: "submitted", expiresAt: wayPast, currentIndex: 2, itemCount: 3 },
        NOW,
      ),
    ).toBe(true);
  });

  it("does NOT reap within the grace (a late answer may still land)", () => {
    expect(
      shouldReapSpeaking(
        { status: "in_progress", expiresAt: withinGrace, currentIndex: 1, itemCount: 3 },
        NOW,
      ),
    ).toBe(false);
  });

  it("does NOT reap before the deadline", () => {
    expect(
      shouldReapSpeaking(
        { status: "in_progress", expiresAt: future, currentIndex: 0, itemCount: 3 },
        NOW,
      ),
    ).toBe(false);
  });

  it("does NOT reap an attempt with every item answered (scoring pending)", () => {
    expect(
      shouldReapSpeaking(
        { status: "submitted", expiresAt: wayPast, currentIndex: 3, itemCount: 3 },
        NOW,
      ),
    ).toBe(false);
  });

  it("does NOT reap a terminal (scored/expired) attempt or one with no deadline", () => {
    expect(
      shouldReapSpeaking(
        { status: "scored", expiresAt: wayPast, currentIndex: 1, itemCount: 3 },
        NOW,
      ),
    ).toBe(false);
    expect(
      shouldReapSpeaking(
        { status: "in_progress", expiresAt: null, currentIndex: 1, itemCount: 3 },
        NOW,
      ),
    ).toBe(false);
  });
});
