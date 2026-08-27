/**
 * Injected interview AUTHORING adapter (Step 34) — the twin of
 * SpeakingAuthoringApi. One editor consumes this on both the college and platform
 * surfaces; `listTopics` (course-attach picker) is platform-only.
 */
import type {
  GameTopicListResponse,
  MockInterviewDetail,
  MockInterviewListResponse,
  MockInterviewUpsert,
  SpeakingTtsResponse,
} from "@codeapt/shared";

import { api } from "./api-client.js";

export interface InterviewAuthoringApi {
  list(): Promise<MockInterviewListResponse>;
  get(id: string): Promise<MockInterviewDetail>;
  create(body: MockInterviewUpsert): Promise<MockInterviewDetail>;
  update(id: string, body: MockInterviewUpsert): Promise<MockInterviewDetail>;
  setPublished(id: string, isPublished: boolean): Promise<MockInterviewDetail>;
  remove(id: string): Promise<void>;
  /** Authoring-time Piper TTS for an author SEED question (fixed voice). */
  generatePromptAudio(text: string): Promise<SpeakingTtsResponse>;
  /** Platform-only: selectable MOCK_INTERVIEW curriculum topics for course attach. */
  listTopics?(): Promise<GameTopicListResponse>;
}

export function collegeInterviewAuthoringApi(
  slug: string,
  group = api.collegeInterview,
): InterviewAuthoringApi {
  return {
    list: () => group.list(slug),
    get: (id) => group.get(slug, id),
    create: (body) => group.create(slug, body),
    update: (id, body) => group.update(slug, id, body),
    setPublished: (id, isPublished) => group.setPublished(slug, id, isPublished),
    remove: (id) => group.remove(slug, id),
    generatePromptAudio: (text) => group.generateTts(slug, text),
  };
}

export function platformInterviewAuthoringApi(
  group = api.adminInterview,
): InterviewAuthoringApi {
  return {
    list: () => group.list(),
    get: (id) => group.get(id),
    create: (body) => group.create(body),
    update: (id, body) => group.update(id, body),
    setPublished: (id, isPublished) => group.setPublished(id, isPublished),
    remove: (id) => group.remove(id),
    generatePromptAudio: (text) => group.generateTts(text),
    listTopics: () => group.topics(),
  };
}
