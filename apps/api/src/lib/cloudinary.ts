/**
 * Cloudinary signed-upload helpers.
 *
 * SECURITY: the api_secret NEVER leaves the server. It is read from env, used
 * only here to compute the SHA-1 upload signature, and is never placed in any
 * response. The browser receives only public values (cloud name + api_key) plus
 * the computed signature + timestamp, and uploads the file DIRECTLY to
 * Cloudinary — the file never transits this API.
 *
 * No SDK dependency: Cloudinary's signed-upload signature is a documented,
 * stable algorithm (SHA-1 of the alphabetically-sorted signed params joined as
 * `k=v&…`, with the api_secret appended), so we compute it with Node crypto.
 */
import { createHash } from "node:crypto";

import { env } from "../config/env.js";

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  /** Server-only — never serialized into a response. */
  apiSecret: string;
}

/**
 * Resolve Cloudinary config from env. Returns null when any of the three vars
 * is absent, so callers can fail clearly (503) instead of half-configuring.
 */
export function getCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

/**
 * Compute a Cloudinary upload signature: SHA-1 hex of the signed params sorted
 * by key and joined `k=v&k=v`, with the api_secret concatenated at the end.
 * `file`, `api_key`, `cloud_name`, and `resource_type` are NEVER signed (per
 * Cloudinary's spec) — pass only the params the client will echo back.
 */
export function signUploadParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1")
    .update(toSign + apiSecret)
    .digest("hex");
}
