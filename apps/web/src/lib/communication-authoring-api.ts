/**
 * The injected adapter for the shared CommunicationAssessment composite editor
 * (S30) — ONE editor, both surfaces (the Step-8 pattern). It carries the composite
 * CRUD, the three artifact-list fetchers the part pickers need (normalised to
 * {id,title,isPublished}), and — platform only — the course-attach topic list.
 * The college adapter binds the tenant slug and lists the college's own
 * artifacts; the platform adapter lists the college:null (platform) artifacts,
 * which is exactly what the server's generalized resolvePartRef binds against.
 */
import type {
  CommunicationAssessmentDetail,
  CommunicationAssessmentListResponse,
  CommunicationAssessmentUpsert,
  GameTopicListResponse,
} from "@codeapt/shared";

import { api } from "./api-client.js";
import type { ArtifactLite } from "./communication-editor.js";

interface ArtifactListLike {
  items: ArtifactLite[];
}

export interface CommunicationAuthoringApi {
  list(): Promise<CommunicationAssessmentListResponse>;
  get(id: string): Promise<CommunicationAssessmentDetail>;
  create(body: CommunicationAssessmentUpsert): Promise<CommunicationAssessmentDetail>;
  update(
    id: string,
    body: CommunicationAssessmentUpsert,
  ): Promise<CommunicationAssessmentDetail>;
  setPublished(
    id: string,
    isPublished: boolean,
  ): Promise<CommunicationAssessmentDetail>;
  remove(id: string): Promise<void>;
  /** Part pickers — the artifacts of this scope, {id,title,isPublished}. */
  listExams(): Promise<ArtifactListLike>;
  listEssays(): Promise<ArtifactListLike>;
  listSpeaking(): Promise<ArtifactListLike>;
  /** Platform-only: selectable COMMUNICATION curriculum topics for course attach. */
  listTopics?(): Promise<GameTopicListResponse>;
}

/** College surface: bind the slug; list the college's own artifacts. */
export function collegeCommunicationAuthoringApi(
  slug: string,
): CommunicationAuthoringApi {
  const g = api.collegeCommunication;
  return {
    list: () => g.list(slug),
    get: (id) => g.get(slug, id),
    create: (body) => g.create(slug, body),
    update: (id, body) => g.update(slug, id, body),
    setPublished: (id, isPublished) => g.setPublished(slug, id, isPublished),
    remove: (id) => g.remove(slug, id),
    listExams: async () => {
      const r = await api.collegeExams.list(slug);
      return {
        items: r.items.map((e) => ({
          id: e.id,
          title: e.title,
          isPublished: e.isPublished,
        })),
      };
    },
    listEssays: async () => {
      const r = await api.collegeEssayTopics.list(slug);
      return {
        items: r.items.map((t) => ({
          id: t.id,
          title: t.title,
          isPublished: t.isPublished,
        })),
      };
    },
    listSpeaking: async () => {
      const r = await api.collegeSpeaking.list(slug);
      return {
        items: r.items.map((s) => ({
          id: s.id,
          title: s.title,
          isPublished: s.isPublished,
        })),
      };
    },
  };
}

/** Platform surface (S30): college:null composite + college:null part artifacts. */
export function platformCommunicationAuthoringApi(): CommunicationAuthoringApi {
  const g = api.adminCommunication;
  return {
    list: () => g.list(),
    get: (id) => g.get(id),
    create: (body) => g.create(body),
    update: (id, body) => g.update(id, body),
    setPublished: (id, isPublished) => g.setPublished(id, isPublished),
    remove: (id) => g.remove(id),
    listExams: async () => {
      // Curriculum (platform) exams have no draft state — readiness is "has
      // content" (server checks ≥1 question; the summary carries questionCount),
      // so a shell with no questions shows as a draft and won't publish as a part.
      const r = await api.adminExams.list();
      return {
        items: r.items.map((e) => ({
          id: e.id,
          title: e.title,
          isPublished: e.questionCount > 0,
        })),
      };
    },
    listEssays: async () => {
      const r = await api.adminEssayTopics.list();
      return {
        items: r.items.map((t) => ({
          id: t.id,
          title: t.title,
          isPublished: t.isActive,
        })),
      };
    },
    listSpeaking: async () => {
      const r = await api.adminSpeaking.list();
      return {
        items: r.items.map((s) => ({
          id: s.id,
          title: s.title,
          isPublished: s.isPublished,
        })),
      };
    },
    listTopics: () => g.topics(),
  };
}
