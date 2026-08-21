/**
 * formatMediaTime — the "m:ss" / "h:mm:ss" readout for the locked-down course
 * video player. Pure, so unit-tested directly.
 */
import { describe, expect, it } from "vitest";

import { formatMediaTime } from "../src/lib/youtube-iframe.js";

describe("formatMediaTime", () => {
  it("formats sub-hour durations as m:ss", () => {
    expect(formatMediaTime(0)).toBe("0:00");
    expect(formatMediaTime(5)).toBe("0:05");
    expect(formatMediaTime(65)).toBe("1:05");
    expect(formatMediaTime(600)).toBe("10:00");
  });

  it("formats hour+ durations as h:mm:ss", () => {
    expect(formatMediaTime(3661)).toBe("1:01:01");
    expect(formatMediaTime(7325)).toBe("2:02:05");
  });

  it("guards against NaN / negative input", () => {
    expect(formatMediaTime(Number.NaN)).toBe("0:00");
    expect(formatMediaTime(-10)).toBe("0:00");
  });
});
