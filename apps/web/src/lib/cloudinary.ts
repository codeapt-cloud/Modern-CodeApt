const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string;

/**
 * Turn a stored image reference into a displayable URL.
 * - Full URLs (http/https) pass through unchanged (new uploads from ImageUpload).
 * - Bare Cloudinary public-ids (e.g. "subjects/generated-image_2_shtcct") from
 *   migrated Django data are expanded to full Cloudinary delivery URLs.
 * - Leading "/" (local/static asset) passes through.
 * - Empty/nullish → "".
 */
export function imageUrl(ref?: string | null): string {
  if (!ref) return "";
  if (/^https?:\/\//i.test(ref)) return ref; // already a full URL
  if (ref.startsWith("/")) return ref; // local/static asset
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${ref}`;
}
