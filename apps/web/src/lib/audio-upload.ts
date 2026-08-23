/**
 * Direct signed upload of a recorded audio blob to Cloudinary. Reuses the
 * existing tenant signature route (resource_type is never signed, so audio uses
 * the SAME signature) and POSTs to the `video/upload` endpoint, which handles
 * audio. Only the resulting URL ever reaches our API — the audio bytes go
 * straight from the browser to Cloudinary.
 */
import { api } from "./api-client.js";

export async function uploadAudioToCloudinary(
  slug: string,
  blob: Blob,
): Promise<string> {
  const sig = await api.uploads.collegeSignature(slug);
  const form = new FormData();
  const file = new File([blob], "recording.webm", {
    type: blob.type || "audio/webm",
  });
  form.append("file", file);
  form.append("api_key", sig.apiKey);
  form.append("timestamp", String(sig.timestamp));
  form.append("folder", sig.folder);
  form.append("signature", sig.signature);
  const resp = await fetch(
    `https://api.cloudinary.com/v1_1/${sig.cloudName}/video/upload`,
    { method: "POST", body: form },
  );
  if (!resp.ok) throw new Error(`Audio upload failed (HTTP ${resp.status})`);
  const json = (await resp.json()) as { secure_url?: string };
  if (!json.secure_url) throw new Error("Audio upload returned no URL");
  return json.secure_url;
}
