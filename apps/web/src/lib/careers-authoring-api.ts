/**
 * The authoring surface the reused posting editor dialog depends on. The dialog
 * calls ONLY these methods — never a concrete api group — so the SAME dialog
 * drives both the platform-admin and college surfaces by swapping the injected
 * `authApi`:
 *   - platform admin → `api.adminCareers` (satisfies this shape as-is; default)
 *   - college        → `collegeCareersAuthoringApi(slug)` (binds the tenant slug)
 *
 * `orgUnitIds` is optional on the body: the admin path omits it (no targeting),
 * the college path includes it (org-unit targeting). Mirrors the exam
 * `ExamAuthoringApi` / essay `EssayAuthoringApi` seams (Phases 4b/4c).
 */
import type {
  AdminPosting,
  AdminPostingUpsert,
  CreateCollegePostingInput,
} from "@codeapt/shared";

import { api } from "./api-client.js";

/** Create/update body — the admin fields plus optional org-unit targeting. */
export type PostingAuthoringBody = AdminPostingUpsert & {
  orgUnitIds?: string[];
};

/** The posting-authoring mutations the reused editor dialog depends on. */
export interface PostingAuthoringApi {
  create(body: PostingAuthoringBody): Promise<AdminPosting>;
  update(id: string, body: PostingAuthoringBody): Promise<AdminPosting>;
}

/** The subset of `api.collegeCareers` this adapter binds a slug onto. */
export interface CollegeCareersAuthoringGroup {
  create(slug: string, body: CreateCollegePostingInput): Promise<AdminPosting>;
  update(
    slug: string,
    id: string,
    body: CreateCollegePostingInput,
  ): Promise<AdminPosting>;
}

/**
 * Bind a tenant `slug` onto the college careers group so it satisfies the
 * slug-free `PostingAuthoringApi` the reused editor dialog expects. `group`
 * defaults to `api.collegeCareers`; inject a fake in tests.
 */
export function collegeCareersAuthoringApi(
  slug: string,
  group: CollegeCareersAuthoringGroup = api.collegeCareers,
): PostingAuthoringApi {
  return {
    create: (body) =>
      group.create(slug, { ...body, orgUnitIds: body.orgUnitIds ?? [] }),
    update: (id, body) =>
      group.update(slug, id, { ...body, orgUnitIds: body.orgUnitIds ?? [] }),
  };
}
