/**
 * The injected adapter for the Speaking assessment editor — ONE editor, both
 * surfaces (the Step-8 pattern; see game-authoring-api.ts). The editor never
 * imports `api` directly; it calls these methods, so the same component serves
 * the college surface (slug-bound) and the platform surface (S30, college:null).
 * `listTopics` is present only on the platform adapter — the course-attach picker
 * is platform-only (a college targets org units, not curriculum topics).
 */
import { api } from "./api-client.js";
import { uploadAudioToCloudinary } from "./audio-upload.js";
import type {
  GameTopicListResponse,
  SpeakingAssessmentDetail,
  SpeakingAssessmentListResponse,
  SpeakingAssessmentUpsert,
  SpeakingTtsResponse,
} from "@codeapt/shared";

export interface SpeakingAuthoringApi {
  list(): Promise<SpeakingAssessmentListResponse>;
  get(id: string): Promise<SpeakingAssessmentDetail>;
  create(body: SpeakingAssessmentUpsert): Promise<SpeakingAssessmentDetail>;
  update(id: string, body: SpeakingAssessmentUpsert): Promise<SpeakingAssessmentDetail>;
  setPublished(id: string, isPublished: boolean): Promise<SpeakingAssessmentDetail>;
  remove(id: string): Promise<void>;
  /** Authoring-time prompt-audio upload → returns the hosted URL. */
  uploadPromptAudio(file: File): Promise<string>;
  /** Authoring-time TTS: render prompt TEXT to a hosted, fixed-voice clip. */
  generatePromptAudio(text: string): Promise<SpeakingTtsResponse>;
  /** Platform-only: selectable SPEAKING curriculum topics for course attach. */
  listTopics?(): Promise<GameTopicListResponse>;
}

/** College surface: bind the tenant slug onto every call. */
export function collegeSpeakingAuthoringApi(
  slug: string,
  group = api.collegeSpeaking,
): SpeakingAuthoringApi {
  return {
    list: () => group.list(slug),
    get: (id) => group.get(slug, id),
    create: (body) => group.create(slug, body),
    update: (id, body) => group.update(slug, id, body),
    setPublished: (id, isPublished) => group.setPublished(slug, id, isPublished),
    remove: (id) => group.remove(slug, id),
    uploadPromptAudio: (file) =>
      uploadAudioToCloudinary(() => group.uploadSignature(slug), file),
    generatePromptAudio: (text) => group.generateTts(slug, text),
  };
}

/** Platform surface (S30): college:null authoring + the course-attach picker. */
export function platformSpeakingAuthoringApi(
  group = api.adminSpeaking,
): SpeakingAuthoringApi {
  return {
    list: () => group.list(),
    get: (id) => group.get(id),
    create: (body) => group.create(body),
    update: (id, body) => group.update(id, body),
    setPublished: (id, isPublished) => group.setPublished(id, isPublished),
    remove: (id) => group.remove(id),
    // Platform authoring uses the admin (requireAdmin) upload signature.
    uploadPromptAudio: (file) =>
      uploadAudioToCloudinary(() => api.uploads.signature(), file),
    generatePromptAudio: (text) => group.generateTts(text),
    listTopics: () => group.topics(),
  };
}
