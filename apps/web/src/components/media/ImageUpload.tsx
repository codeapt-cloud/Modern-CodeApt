/**
 * Reusable signed-image upload control (Cloudinary).
 *
 * FLOW: the API issues a short-lived signature (server-only api_secret), then
 * the browser uploads the file DIRECTLY to Cloudinary with it and we keep the
 * returned secure_url. The value stored on the record stays a plain URL string,
 * so existing records (and pasted URLs) keep working — this only changes HOW a
 * URL gets populated. A URL text field is kept as a fallback (backward-compat +
 * a graceful path when Cloudinary isn't configured, which surfaces as a clear
 * message rather than a broken control).
 *
 * Controlled: `value` is the current URL; `onChange` receives the new URL.
 */
import { ImageOff, UploadCloud, X } from "lucide-react";
import { useRef, useState } from "react";

import { api, parseApiError } from "../../lib/api-client.js";
import { imageUrl } from "../../lib/cloudinary.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

const CLOUDINARY_UPLOAD_URL = (cloudName: string): string =>
  `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

export interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  /** Accepted mime hint for the file picker. */
  accept?: string;
}

export function ImageUpload({
  value,
  onChange,
  disabled = false,
  accept = "image/*",
}: ImageUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);

  const handleFile = async (file: File): Promise<void> => {
    setUploading(true);
    setError("");
    try {
      let sig;
      try {
        sig = await api.uploads.signature();
      } catch (err) {
        const parsed = parseApiError(err);
        setError(
          parsed.code === "UPLOAD_NOT_CONFIGURED"
            ? "Image uploads aren't configured on the server. Paste an image URL below instead."
            : parsed.message || "Couldn't start the upload.",
        );
        return;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", sig.apiKey);
      form.append("timestamp", String(sig.timestamp));
      form.append("folder", sig.folder);
      form.append("signature", sig.signature);

      const resp = await fetch(CLOUDINARY_UPLOAD_URL(sig.cloudName), {
        method: "POST",
        body: form,
      });
      if (!resp.ok) {
        setError(`Cloudinary rejected the upload (HTTP ${resp.status}).`);
        return;
      }
      const json = (await resp.json()) as { secure_url?: string };
      if (!json.secure_url) {
        setError("Upload succeeded but no URL was returned.");
        return;
      }
      setPreviewFailed(false);
      onChange(json.secure_url);
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again re-fires change.
    e.target.value = "";
    if (file) void handleFile(file);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        {/* Preview (existing URLs render too) */}
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-subtle bg-surface-base">
          {value && !previewFailed ? (
            <img
              src={imageUrl(value)}
              alt="Preview"
              className="h-full w-full object-cover"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <ImageOff className="h-6 w-6 text-ink-muted" aria-hidden />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={onPick}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={uploading}
              disabled={disabled || uploading}
              onClick={() => fileRef.current?.click()}
            >
              <UploadCloud className="h-4 w-4" />
              {value ? "Replace image" : "Upload image"}
            </Button>
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || uploading}
                onClick={() => {
                  setPreviewFailed(false);
                  onChange("");
                }}
              >
                <X className="h-4 w-4" /> Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-ink-muted">
            Uploads go straight to Cloudinary — the file never touches our
            server, and no credential is exposed.
          </p>
        </div>
      </div>

      {/* URL fallback: backward-compat + works without Cloudinary creds. */}
      <Input
        type="url"
        placeholder="or paste an image URL (https://…)"
        value={value}
        disabled={disabled || uploading}
        onChange={(e) => {
          setPreviewFailed(false);
          onChange(e.target.value);
        }}
      />

      {error ? <p className="text-xs text-error-fg">{error}</p> : null}
      {value && previewFailed ? (
        <p className="text-xs text-ink-muted">
          Couldn&apos;t load a preview for this URL, but it will still be saved.
        </p>
      ) : null}
    </div>
  );
}
