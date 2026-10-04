/**
 * Capability-map drift guard (Step 40). The map in capabilities.ts is HAND-authored
 * (routes, nav, button labels, prerequisites). These machine checks are what make
 * it a MAP and not a snapshot — they fail in CI the moment a quoted route or button
 * label no longer exists in the SPA, so the guide can't confidently send an admin to
 * a control that was renamed/removed:
 *   1. every `route` in the map exists as a <Route path> in apps/web/src/App.tsx
 *      (param-agnostic);
 *   2. every `controls` label appears verbatim somewhere in apps/web/src;
 *   3. keys are unique.
 * (Nav text, step ORDERING and prose stay purely hand-maintained — those can't be
 * mechanically tied to one symbol; this guard covers the two that break "take me
 * there" and "click this button".)
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ADMIN_CAPABILITIES } from "../src/services/admin-assistant/capabilities.js";

const WEB_SRC = fileURLToPath(new URL("../../web/src/", import.meta.url));

/** Collapse route params so `/c/:slug/x` and `/c/:collegeSlug/x` compare equal. */
const normRoute = (p: string): string =>
  p.replace(/:[^/]+/g, ":p").replace(/\/+$/, "") || "/";

function appRoutePaths(): Set<string> {
  const app = readFileSync(`${WEB_SRC}App.tsx`, "utf8");
  const raw = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]!);
  const set = new Set<string>();
  for (const r of raw) {
    if (r.startsWith("/")) set.add(normRoute(r));
    // College-area children are RELATIVE to the parent "/c/:collegeSlug".
    else set.add(normRoute(`/c/:collegeSlug/${r}`));
  }
  return set;
}

function readWebSource(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}${e.name}`;
      if (e.isDirectory()) walk(`${full}/`);
      else if (/\.tsx?$/.test(e.name)) parts.push(readFileSync(full, "utf8"));
    }
  };
  walk(WEB_SRC);
  return parts.join("\n");
}

describe("capability map integrity (anti-drift)", () => {
  it("every route in the map exists as a Route path in App.tsx", () => {
    const routes = appRoutePaths();
    const missing = ADMIN_CAPABILITIES.filter(
      (c) => !routes.has(normRoute(c.route)),
    ).map((c) => `${c.key} → ${c.route}`);
    expect(missing).toEqual([]);
  });

  it("every quoted control label appears verbatim in a web component", () => {
    const src = readWebSource();
    const missing: string[] = [];
    for (const c of ADMIN_CAPABILITIES) {
      for (const label of c.controls ?? []) {
        if (!src.includes(label)) missing.push(`${c.key}: "${label}"`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keys are unique", () => {
    const keys = ADMIN_CAPABILITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers both surfaces", () => {
    const surfaces = new Set(ADMIN_CAPABILITIES.map((c) => c.surface));
    expect(surfaces.has("platform")).toBe(true);
    expect(surfaces.has("college")).toBe(true);
  });
});
