/**
 * The slug-free authoring surface the shared GameSetEditor + list depend on, so
 * ONE editor serves both surfaces. The platform-admin factory returns the
 * slug-less `api.adminGameSets` methods directly; the college factory binds the
 * tenant `slug` onto every `api.collegeGames` authoring method (mirroring
 * exam-authoring-api's collegeExamAuthoringApi). `templates`/`clone` are
 * college-only and absent on the platform surface.
 */
import {
  type AiBuildGameSetResponse,
  type GameSetDetail,
  type GameSetListResponse,
  type GameSetUpdate,
  type GameSetUpsert,
} from "@codeapt/shared";

import { api } from "./api-client.js";

export interface GameAuthoringApi {
  list(): Promise<GameSetListResponse>;
  get(id: string): Promise<GameSetDetail>;
  create(body: GameSetUpsert): Promise<GameSetDetail>;
  update(id: string, body: GameSetUpdate): Promise<GameSetDetail>;
  setPublished(id: string, isPublished: boolean): Promise<GameSetDetail>;
  remove(id: string): Promise<void>;
  aiBuild(brief: string): Promise<AiBuildGameSetResponse>;
  /** College-only: browse published platform sets to clone as a template. */
  templates?(): Promise<GameSetListResponse>;
  /** College-only: clone a platform set into this college. */
  clone?(sourceId: string, title: string): Promise<GameSetDetail>;
}

/** Platform-admin adapter — `api.adminGameSets` already fits the interface. */
export function gameAuthoringApi(): GameAuthoringApi {
  const a = api.adminGameSets;
  return {
    list: () => a.list(),
    get: (id) => a.get(id),
    create: (body) => a.create(body),
    update: (id, body) => a.update(id, body),
    setPublished: (id, isPublished) => a.setPublished(id, isPublished),
    remove: (id) => a.remove(id),
    aiBuild: (brief) => a.aiBuild({ brief }),
  };
}

/** The minimal college authoring group (for injection + unit tests). */
export interface CollegeGameAuthoringGroup {
  list(slug: string): Promise<GameSetListResponse>;
  get(slug: string, id: string): Promise<GameSetDetail>;
  create(slug: string, body: GameSetUpsert): Promise<GameSetDetail>;
  update(slug: string, id: string, body: GameSetUpdate): Promise<GameSetDetail>;
  setPublished(slug: string, id: string, isPublished: boolean): Promise<GameSetDetail>;
  remove(slug: string, id: string): Promise<void>;
  templates(slug: string): Promise<GameSetListResponse>;
  clone(slug: string, sourceId: string, title: string): Promise<GameSetDetail>;
  aiBuild(slug: string, body: { brief: string }): Promise<AiBuildGameSetResponse>;
}

/** College adapter — binds `slug` onto every method. */
export function collegeGameAuthoringApi(
  slug: string,
  group: CollegeGameAuthoringGroup = api.collegeGames,
): GameAuthoringApi {
  return {
    list: () => group.list(slug),
    get: (id) => group.get(slug, id),
    create: (body) => group.create(slug, body),
    update: (id, body) => group.update(slug, id, body),
    setPublished: (id, isPublished) => group.setPublished(slug, id, isPublished),
    remove: (id) => group.remove(slug, id),
    aiBuild: (brief) => group.aiBuild(slug, { brief }),
    templates: () => group.templates(slug),
    clone: (sourceId, title) => group.clone(slug, sourceId, title),
  };
}
