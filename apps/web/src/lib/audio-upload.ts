/**
 * Direct signed upload of a recorded/authored audio blob to Cloudinary. The
 * caller supplies a SIGNATURE FETCHER — the college surface fetches the member
 * speaking signature (`/c/:slug/speaking/uploads/signature`), the B2C surface the
 * global one (`/speaking/uploads/signature`), platform authoring the admin one.
 * `resource_type` is never signed, so audio uses the SAME signature; we POST to
 * the `video/upload` endpoint (which handles audio). Only the resulting URL ever
 * reaches our API — the audio bytes go straight to Cloudinary.
 */
import type { UploadSignatureResponse } from "@codeapt/shared";

export async function uploadAudioToCloudinary(
  getSignature: () => Promise<UploadSignatureResponse>,
  blob: Blob,
): Promise<string> {
  const sig = await getSignature();
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
