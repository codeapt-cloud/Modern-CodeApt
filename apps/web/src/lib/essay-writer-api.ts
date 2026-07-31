/**
 * The writing surface the reused essay writer depends on (the writer page, the
 * grading hook, and the autosave-draft hook). They call ONLY these methods —
 * never a concrete api group — so the SAME writer drives both surfaces by
 * swapping the injected `writerApi`:
 *   - individual → `api.essays` (satisfies this shape as-is; the default)
 *   - college    → `collegeEssayWriterApi(slug)` (binds the tenant slug)
 *
 * Only list/detail/draft/submit/submissions are tenant-scoped; the grading-status
 * POLL (`submission`) + `analytics` are authorized by attempt OWNERSHIP, so the
 * college adapter routes them to the SHARED `api.essays` endpoints unchanged —
 * mirroring the exam runner's shared `/attempts/*` (Phase 4b-ii-B).
 */
import type {
  EssayAnalyticsInput,
  EssayDraftResponse,
  EssayGradingResult,
  EssayIntegrity,
  EssayPromptDetail,
  EssaySubmissionListResponse,
  JobRef,
  SaveEssayDraftResponse,
} from "@codeapt/shared";

import { api } from "./api-client.js";

/** The essay-writing calls the reused writer + its hooks depend on. */
export interface EssayWriterApi {
  get(id: string): Promise<EssayPromptDetail>;
  submissions(id: string): Promise<EssaySubmissionListResponse>;
  submit(
    id: string,
    content: string,
    integrity?: EssayIntegrity,
  ): Promise<JobRef>;
  saveDraft(id: string, content: string): Promise<SaveEssayDraftResponse>;
  draft(id: string): Promise<EssayDraftResponse>;
  /** Ownership-authorized → shared across surfaces. */
  submission(jobId: string): Promise<EssayGradingResult>;
  /** Ownership-authorized → shared across surfaces. */
  analytics(jobId: string, body: EssayAnalyticsInput): Promise<void>;
}

/** The subset of `api.collegeEssays` this adapter binds a slug onto. */
export interface CollegeEssayWriterGroup {
  detail(slug: string, id: string): Promise<EssayPromptDetail>;
  submissions(slug: string, id: string): Promise<EssaySubmissionListResponse>;
  submit(
    slug: string,
    id: string,
    content: string,
    integrity?: EssayIntegrity,
  ): Promise<JobRef>;
  draftPut(
    slug: string,
    id: string,
    content: string,
  ): Promise<SaveEssayDraftResponse>;
  draftGet(slug: string, id: string): Promise<EssayDraftResponse>;
}

/** The shared (ownership-authorized) grading endpoints reused by both surfaces. */
export interface SharedEssayGradingApi {
  submission(jobId: string): Promise<EssayGradingResult>;
  analytics(jobId: string, body: EssayAnalyticsInput): Promise<void>;
}

/**
 * Bind a tenant `slug` onto the college essay group so it satisfies the slug-free
 * `EssayWriterApi` the reused writer expects. The grading poll + analytics fall
 * through to the shared endpoints (default `api.essays`). Inject fakes in tests.
 */
export function collegeEssayWriterApi(
  slug: string,
  group: CollegeEssayWriterGroup = api.collegeEssays,
  shared: SharedEssayGradingApi = api.essays,
): EssayWriterApi {
  return {
    get: (id) => group.detail(slug, id),
    submissions: (id) => group.submissions(slug, id),
    submit: (id, content, integrity) =>
      group.submit(slug, id, content, integrity),
    saveDraft: (id, content) => group.draftPut(slug, id, content),
    draft: (id) => group.draftGet(slug, id),
    submission: (jobId) => shared.submission(jobId),
    analytics: (jobId, body) => shared.analytics(jobId, body),
  };
}
