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

/**
 * SERVER-SIDE signed upload (Step 19). Unlike the browser flow — where we only
 * MINT a signature and the file goes browser → Cloudinary — a TTS clip is
 * generated on the server (Piper), so the server must upload it itself. Same
 * signed-params algorithm; the file is POSTed as multipart with fetch, so no SDK
 * is added. Returns the hosted secure_url. Throws if Cloudinary is unconfigured
 * or the upload fails. `resourceType` is "video" for audio (matches the browser
 * path — Cloudinary handles audio under the video resource type).
 */
export async function uploadBufferToCloudinary(
  bytes: Uint8Array,
  opts: { folder: string; filename?: string; resourceType?: "video" | "raw" },
): Promise<string> {
  const config = getCloudinaryConfig();
  if (!config) {
    throw new Error("Cloudinary is not configured (CLOUDINARY_* unset).");
  }
  const resourceType = opts.resourceType ?? "video";
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signUploadParams(
    { folder: opts.folder, timestamp },
    config.apiSecret,
  );
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: "audio/wav" }),
    opts.filename ?? "prompt.wav",
  );
  form.append("api_key", config.apiKey);
  form.append("timestamp", String(timestamp));
  form.append("folder", opts.folder);
  form.append("signature", signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* keep the status */
    }
    throw new Error(`Cloudinary upload failed: ${detail}`);
  }
  const json = (await res.json()) as { secure_url?: string };
  if (!json.secure_url) {
    throw new Error("Cloudinary upload returned no secure_url.");
  }
  return json.secure_url;
}
