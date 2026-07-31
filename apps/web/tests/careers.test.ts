/**
 * Unit tests for the pure careers helpers: the shared posting open/closed gate
 * (@codeapt/shared) + the web-side apply-affordance selector and status → badge
 * presentation (lib/careers-ui). No I/O.
 */
import {
  CareerErrorCode,
  JobApplicationStatus,
  PostingType,
  isPostingOpen,
  postingOpenState,
  type MyApplicationRef,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  applyAffordance,
  postingTypeLabel,
  statusBadgeVariant,
  statusLabel,
} from "../src/lib/careers-ui.js";

const NOW = Date.UTC(2026, 0, 15);

describe("postingOpenState", () => {
  it("open when active and no deadline", () => {
    const r = postingOpenState({ isActive: true, deadlineMs: null }, NOW);
    expect(r.isOpen).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("open when active and deadline in the future", () => {
    expect(
      postingOpenState({ isActive: true, deadlineMs: NOW + 1000 }, NOW).isOpen,
    ).toBe(true);
  });

  it("inactive → closed", () => {
    const r = postingOpenState({ isActive: false, deadlineMs: null }, NOW);
    expect(r.isOpen).toBe(false);
    expect(r.reason).toBe(CareerErrorCode.POSTING_CLOSED);
  });

  it("past deadline → deadline_passed", () => {
    const r = postingOpenState({ isActive: true, deadlineMs: NOW - 1 }, NOW);
    expect(r.isOpen).toBe(false);
    expect(r.reason).toBe(CareerErrorCode.DEADLINE_PASSED);
  });

  it("deadline exactly now is still open (inclusive)", () => {
    expect(
      postingOpenState({ isActive: true, deadlineMs: NOW }, NOW).isOpen,
    ).toBe(true);
  });

  it("inactive takes precedence over a future deadline", () => {
    expect(
      postingOpenState({ isActive: false, deadlineMs: NOW + 1000 }, NOW).reason,
    ).toBe(CareerErrorCode.POSTING_CLOSED);
  });

  it("isPostingOpen is the boolean form", () => {
    expect(isPostingOpen({ isActive: true, deadlineMs: null }, NOW)).toBe(true);
    expect(isPostingOpen({ isActive: false, deadlineMs: null }, NOW)).toBe(
      false,
    );
  });
});

const APP: MyApplicationRef = {
  id: "a1",
  status: JobApplicationStatus.SUBMITTED,
  appliedAt: "2026-01-10T00:00:00.000Z",
};

describe("applyAffordance", () => {
  it("external wins whenever an applyUrl is present (even when closed)", () => {
    expect(
      applyAffordance({
        applyUrl: "https://co.example/jobs/1",
        isOpen: true,
        myApplication: null,
      }),
    ).toBe("external");
    expect(
      applyAffordance({
        applyUrl: "https://co.example/jobs/1",
        isOpen: false,
        myApplication: null,
      }),
    ).toBe("external");
  });

  it("no applyUrl + open + not applied → apply", () => {
    expect(
      applyAffordance({ applyUrl: "", isOpen: true, myApplication: null }),
    ).toBe("apply");
  });

  it("no applyUrl + already applied → status (even if closed)", () => {
    expect(
      applyAffordance({ applyUrl: "", isOpen: true, myApplication: APP }),
    ).toBe("status");
    expect(
      applyAffordance({ applyUrl: "", isOpen: false, myApplication: APP }),
    ).toBe("status");
  });

  it("no applyUrl + closed + not applied → closed", () => {
    expect(
      applyAffordance({ applyUrl: "  ", isOpen: false, myApplication: null }),
    ).toBe("closed");
  });
});

describe("status presentation", () => {
  it("labels every status", () => {
    expect(statusLabel(JobApplicationStatus.SUBMITTED)).toBe("Submitted");
    expect(statusLabel(JobApplicationStatus.UNDER_REVIEW)).toBe("Under review");
    expect(statusLabel(JobApplicationStatus.SHORTLISTED)).toBe("Shortlisted");
    expect(statusLabel(JobApplicationStatus.REJECTED)).toBe("Rejected");
    expect(statusLabel(JobApplicationStatus.HIRED)).toBe("Hired");
  });

  it("maps status → badge variant", () => {
    expect(statusBadgeVariant(JobApplicationStatus.HIRED)).toBe("success");
    expect(statusBadgeVariant(JobApplicationStatus.REJECTED)).toBe("error");
    expect(statusBadgeVariant(JobApplicationStatus.SHORTLISTED)).toBe(
      "primary",
    );
    expect(statusBadgeVariant(JobApplicationStatus.UNDER_REVIEW)).toBe(
      "warning",
    );
    expect(statusBadgeVariant(JobApplicationStatus.SUBMITTED)).toBe("info");
  });

  it("labels posting types", () => {
    expect(postingTypeLabel(PostingType.FULL_TIME)).toBe("Full-time");
    expect(postingTypeLabel(PostingType.INTERNSHIP)).toBe("Internship");
    expect(postingTypeLabel(PostingType.PART_TIME)).toBe("Part-time");
    expect(postingTypeLabel(PostingType.CONTRACT)).toBe("Contract");
  });
});
