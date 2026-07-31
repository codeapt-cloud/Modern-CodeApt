/**
 * The authoring surface the reused essay-topic editor dialog depends on. The
 * dialog calls ONLY these methods — never a concrete api group — so the SAME
 * dialog drives both the platform-admin and college surfaces by swapping the
 * injected `authApi`:
 *   - platform admin → `api.adminEssayTopics` (satisfies this shape as-is; default)
 *   - college        → `collegeEssayAuthoringApi(slug)` (binds the tenant slug)
 *
 * `orgUnitIds` is optional on the body: the admin path omits it (no targeting),
 * the college path includes it (org-unit targeting). Mirrors the exam
 * `ExamAuthoringApi` seam (Phase 4b-ii-A).
 */
import type {
  AdminEssayTopic,
  AdminEssayTopicUpsert,
  CreateCollegeEssayInput,
  GenerateKeywordsRequest,
  GenerateKeywordsResponse,
} from "@codeapt/shared";

import { api } from "./api-client.js";

/** Create/update body — the admin fields plus optional org-unit targeting. */
export type EssayAuthoringBody = AdminEssayTopicUpsert & {
  orgUnitIds?: string[];
};

/** The essay-authoring mutations the reused editor dialog depends on. */
export interface EssayAuthoringApi {
  create(body: EssayAuthoringBody): Promise<AdminEssayTopic>;
  update(id: string, body: EssayAuthoringBody): Promise<AdminEssayTopic>;
  generateKeywords(
    input: GenerateKeywordsRequest,
  ): Promise<GenerateKeywordsResponse>;
}

/** The subset of `api.collegeEssayTopics` this adapter binds a slug onto. */
export interface CollegeEssayAuthoringGroup {
  create(
    slug: string,
    body: CreateCollegeEssayInput,
  ): Promise<AdminEssayTopic>;
  update(
    slug: string,
    id: string,
    body: CreateCollegeEssayInput,
  ): Promise<AdminEssayTopic>;
  generateKeywords(
    slug: string,
    body: GenerateKeywordsRequest,
  ): Promise<GenerateKeywordsResponse>;
}

/**
 * Bind a tenant `slug` onto the college essay-topic group so it satisfies the
 * slug-free `EssayAuthoringApi` the reused editor dialog expects. `group`
 * defaults to `api.collegeEssayTopics`; inject a fake in tests.
 */
export function collegeEssayAuthoringApi(
  slug: string,
  group: CollegeEssayAuthoringGroup = api.collegeEssayTopics,
): EssayAuthoringApi {
  return {
    create: (body) =>
      group.create(slug, { ...body, orgUnitIds: body.orgUnitIds ?? [] }),
    update: (id, body) =>
      group.update(slug, id, { ...body, orgUnitIds: body.orgUnitIds ?? [] }),
    generateKeywords: (input) => group.generateKeywords(slug, input),
  };
}
