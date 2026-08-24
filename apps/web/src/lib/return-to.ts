/**
 * Validate a user-controllable `?from=` return target (Step 25 C3). The composite
 * launches a student into an engine runner and passes where to return; because
 * that value rides in the URL, it must be treated as untrusted. We accept ONLY an
 * in-app, same-origin PATH and reject anything that could become an open redirect.
 *
 * Rejected: absolute URLs (`http:`, `javascript:`, any scheme — they don't begin
 * with a single "/"), protocol-relative URLs (`//host`, and `/\host` which some
 * browsers normalise to `//`), backslashes, control/whitespace characters, and
 * path-traversal segments (`..`). Client-side `navigate()` already keeps routing
 * within the SPA, so this is defence-in-depth on top of that.
 *
 * Returns the path unchanged when safe, or null — callers fall back to their own
 * default destination, so an invalid value simply behaves like no `from` at all.
 */

export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 512) return null;
  // Must be a rooted path — not a scheme (`http:`…) and not a bare relative ref.
  if (!raw.startsWith("/")) return null;
  // Protocol-relative (`//host`) or the `/\` variant browsers treat as `//`.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  // No backslashes anywhere (used to smuggle host authorities past naive checks).
  if (raw.includes("\\")) return null;
  // No control chars or whitespace (0x00-0x20): a newline can hide a second URL,
  // and a genuine path percent-encodes any space or control character.
  for (let i = 0; i < raw.length; i += 1) {
    if (raw.charCodeAt(i) <= 0x20) return null; // control char or space
  }
  // No path-traversal segments in the path portion.
  const pathOnly = raw.split(/[?#]/, 1)[0]!;
  if (pathOnly.split("/").some((seg) => seg === "..")) return null;
  return raw;
}
