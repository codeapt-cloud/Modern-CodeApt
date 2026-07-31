/**
 * YouTube id extraction — mirrors the original Django `extract_video_id`.
 * Accepts a bare 11-char id or a watch/short/embed/shorts URL and returns the
 * id, or "" when nothing matches. Used by the bulk topic importer to auto-detect
 * a "video" topic from a video_url column (and to normalise video_id input).
 */
const ID = "[A-Za-z0-9_-]{11}";
const URL_PATTERNS = [
  new RegExp(`[?&]v=(${ID})`),
  new RegExp(`youtu\\.be/(${ID})`),
  new RegExp(`youtube\\.com/embed/(${ID})`),
  new RegExp(`youtube\\.com/shorts/(${ID})`),
];

export function extractVideoId(input: string): string {
  const s = (input ?? "").trim();
  if (!s) return "";
  // A bare id already (no scheme / slashes / query).
  if (new RegExp(`^${ID}$`).test(s)) return s;
  for (const re of URL_PATTERNS) {
    const m = re.exec(s);
    if (m?.[1]) return m[1];
  }
  return "";
}
