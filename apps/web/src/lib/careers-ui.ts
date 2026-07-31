/**
 * Pure helpers for the careers UI — the primary apply affordance a posting
 * detail page should show, plus status → badge presentation. No I/O, no React;
 * unit-tested. The server owns the open/closed gate + apply idempotency; these
 * only drive which control the student sees.
 */
import {
  JobApplicationStatus,
  PostingType,
  type JobApplicationStatus as JobApplicationStatusT,
  type MyApplicationRef,
  type PostingType as PostingTypeT,
} from "@codeapt/shared";

/**
 * The single primary action a posting detail page offers:
 *  - `external` — the posting redirects out to a company site (has applyUrl);
 *  - `apply`    — in-app apply available (open, no applyUrl, not yet applied);
 *  - `status`   — the caller already applied in-app; show their status badge;
 *  - `closed`   — no applyUrl and the posting is closed / past deadline.
 *
 * `external` wins first: an applyUrl posting has nothing to track in-app, so we
 * always defer to the company site regardless of open/closed (the anchor is
 * informational once closed — the server never stores an in-app application).
 * Among the in-app branches, an existing application wins over the closed gate
 * so an applicant is never shown a dead "closed" for a posting they applied to.
 */
export type ApplyAffordance = "external" | "apply" | "status" | "closed";

export function applyAffordance(params: {
  applyUrl: string;
  isOpen: boolean;
  myApplication: MyApplicationRef | null;
}): ApplyAffordance {
  const { applyUrl, isOpen, myApplication } = params;
  if (applyUrl.trim().length > 0) return "external";
  if (myApplication) return "status";
  if (!isOpen) return "closed";
  return "apply";
}

/** Human label for an application status. */
export function statusLabel(status: JobApplicationStatusT): string {
  switch (status) {
    case JobApplicationStatus.SUBMITTED:
      return "Submitted";
    case JobApplicationStatus.UNDER_REVIEW:
      return "Under review";
    case JobApplicationStatus.SHORTLISTED:
      return "Shortlisted";
    case JobApplicationStatus.REJECTED:
      return "Rejected";
    case JobApplicationStatus.HIRED:
      return "Hired";
    default:
      return status;
  }
}

export type BadgeVariant =
  | "primary"
  | "neutral"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "outline";

/** Badge colour for an application status. */
export function statusBadgeVariant(status: JobApplicationStatusT): BadgeVariant {
  switch (status) {
    case JobApplicationStatus.SUBMITTED:
      return "info";
    case JobApplicationStatus.UNDER_REVIEW:
      return "warning";
    case JobApplicationStatus.SHORTLISTED:
      return "primary";
    case JobApplicationStatus.HIRED:
      return "success";
    case JobApplicationStatus.REJECTED:
      return "error";
    default:
      return "neutral";
  }
}

/** Human label for a posting employment type. */
export function postingTypeLabel(type: PostingTypeT): string {
  switch (type) {
    case PostingType.FULL_TIME:
      return "Full-time";
    case PostingType.INTERNSHIP:
      return "Internship";
    case PostingType.PART_TIME:
      return "Part-time";
    case PostingType.CONTRACT:
      return "Contract";
    default:
      return type;
  }
}
