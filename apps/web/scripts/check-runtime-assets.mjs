/**
 * Post-build guard (Step 37.5): verify the assets TalkingHead resolves AT RUNTIME
 * actually exist in dist/. This class of bug — the avatar chunk loaded, the model
 * loaded, but a runtime-resolved same-origin file 404'd (the SPA served index.html)
 * — is invisible to bundling and to the unit suite. It bit us twice:
 *   - `/assets/lipsync-en.mjs` (TalkingHead's computed `import(path+'lipsync-'+lang)`);
 *   - and it's the same shape as the audio worklet (`new URL('./playback-worklet.js',
 *     import.meta.url)`).
 *
 * Runs as `postbuild` (npm runs it after `vite build`), so a fresh CI build fails
 * here — not in a Cloudflare deploy log or a user's console.
 *
 * Checks, only when TalkingHead is actually in the build:
 *  1. every `new URL("<same-origin>", import.meta.url)` asset reference in a chunk
 *     points at a file that exists in dist/assets (catches the worklet class);
 *  2. the lip-sync chunk (lipsync-en-*.js) is emitted — i.e. lip-sync is BUNDLED,
 *     not left to TalkingHead's runtime path loader (catches a regression of the
 *     lipsyncModules:[] fix).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const ASSETS = join("dist", "assets"); // cwd is apps/web (npm postbuild)

if (!existsSync(ASSETS)) {
  console.warn("[runtime-assets] no dist/assets — skipping (nothing built).");
  process.exit(0);
}

const files = readdirSync(ASSETS);
const jsFiles = files.filter((f) => /\.(js|mjs)$/.test(f));
const hasTalkingHead = jsFiles.some((f) => /^talkinghead-/.test(f));

if (!hasTalkingHead) {
  console.log("[runtime-assets] TalkingHead not in this build — nothing to check.");
  process.exit(0);
}

const problems = [];

// 1. new URL("<path>", import.meta.url) → the referenced same-origin asset exists.
const urlRe = /new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
for (const f of jsFiles) {
  const code = readFileSync(join(ASSETS, f), "utf8");
  let m;
  while ((m = urlRe.exec(code)) !== null) {
    const ref = m[1].split("?")[0];
    const base = basename(ref);
    if (!/\.(js|mjs|wasm|json|bin)$/.test(base)) continue; // ignore non-asset URLs
    if (!files.includes(base)) {
      problems.push(`${f}: new URL("${ref}") → "${base}" is NOT in dist/assets (would 404 at runtime).`);
    }
  }
}

// 2. lip-sync must be a bundled chunk, not a runtime path import.
if (!jsFiles.some((f) => /^lipsync-en.*\.(js|mjs)$/.test(f))) {
  problems.push(
    "TalkingHead is bundled but no lipsync-en-*.js chunk was emitted — lip-sync is " +
      "likely being loaded via TalkingHead's runtime `import('./lipsync-en.mjs')`, " +
      "which 404s under a hashed /assets/ build. Import it statically and pass " +
      "lipsyncModules:[] (see talkinghead-controller.ts).",
  );
}

if (problems.length > 0) {
  console.error(
    "\n[runtime-assets] FAIL — TalkingHead runtime asset(s) missing from dist:\n" +
      problems.map((p) => `  • ${p}`).join("\n") +
      "\n",
  );
  process.exit(1);
}

console.log("[runtime-assets] ok — TalkingHead's runtime-resolved assets exist in dist.");
