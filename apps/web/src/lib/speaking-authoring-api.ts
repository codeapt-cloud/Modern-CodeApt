/**
 * The injected adapter for the Speaking assessment editor — one editor, both
 * surfaces, exactly the Step-8 pattern (see game-authoring-api.ts). The editor
 * never imports `api` directly; it calls these methods, so the same component
 * serves the college surface (slug-bound, below) and a future platform surface
 * (whenever a platform-admin speaking API is added — none exists today, so only
 * the college adapter is wired; see the Step-13 report).
 */
import { api } from "./api-client.js";
import { uploadAudioToCloudinary } from "./audio-upload.js";
import type {
  SpeakingAssessmentDetail,
  SpeakingAssessmentListResponse,
  SpeakingAssessmentUpsert,
} from "@codeapt/shared";

export interface SpeakingAuthoringApi {
  list(): Promise<SpeakingAssessmentListResponse>;
  get(id: string): Promise<SpeakingAssessmentDetail>;
  create(body: SpeakingAssessmentUpsert): Promise<SpeakingAssessmentDetail>;
  update(id: string, body: SpeakingAssessmentUpsert): Promise<SpeakingAssessmentDetail>;
  setPublished(id: string, isPublished: boolean): Promise<SpeakingAssessmentDetail>;
  remove(id: string): Promise<void>;
  /** Authoring-time prompt-audio upload → returns the hosted URL. TTS is not
   *  API-callable (see the report), so authors upload a clip here. */
  uploadPromptAudio(file: File): Promise<string>;
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
    uploadPromptAudio: (file) => uploadAudioToCloudinary(slug, file),
  };
}
