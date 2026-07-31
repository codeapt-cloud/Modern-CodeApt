/**
 * URL join helpers for hand-built API URLs (e.g. the SSE stream endpoint, which
 * bypasses axios). Axios normalizes its own base+path join, but manual template
 * strings do not — so a `VITE_API_URL` ending in "/" would yield a double slash
 * (`http://host//api/...`) that 404s. `apiUrl` collapses base+path to exactly
 * one slash while preserving the protocol's "//".
 */

/**
 * Join an API base URL with an absolute path using exactly one separating slash.
 * An empty base yields a root-relative path (dev: `/api/...`, proxied by Vite).
 */
export function apiUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}
