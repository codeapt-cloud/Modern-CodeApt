/**
 * Signed-upload service (image storage). Issues a short-lived Cloudinary upload
 * signature so the browser can upload an image DIRECTLY to Cloudinary without
 * the api_secret ever leaving the server.
 *
 * The response carries public values only (cloud name + api_key) plus the
 * computed signature — never the secret. If Cloudinary is not configured we
 * fail clearly with 503 UPLOAD_NOT_CONFIGURED (never a secret-leaking fallback).
 */
import {
  CLOUDINARY_UPLOAD_FOLDER,
  UploadErrorCode,
  type UploadSignatureResponse,
} from "@codeapt/shared";

import { AppError } from "../errors/app-error.js";
import {
  getCloudinaryConfig,
  signUploadParams,
} from "../lib/cloudinary.js";

export function createUploadSignature(): UploadSignatureResponse {
  const config = getCloudinaryConfig();
  if (!config) {
    throw new AppError(
      "Image uploads are not configured on the server.",
      503,
      UploadErrorCode.UPLOAD_NOT_CONFIGURED,
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = CLOUDINARY_UPLOAD_FOLDER;

  // Sign only what the client echoes back (folder + timestamp); the secret is
  // used to compute the signature and is never returned.
  const signature = signUploadParams({ folder, timestamp }, config.apiSecret);

  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    timestamp,
    folder,
    signature,
  };
}
