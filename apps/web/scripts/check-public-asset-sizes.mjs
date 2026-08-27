/**
 * Build-time guard (Step 37.3): fail the build if any DEPLOYED file under
 * apps/web/public exceeds the size cap, so an oversized asset is caught here with
 * a clear message — NOT discovered only in a Cloudflare Pages deploy log (Pages
 * rejects files > 25 MiB). Runs as `prebuild` (npm runs it before `vite build`).
 *
 * It checks GIT-TRACKED files only (via `git ls-files`), because that is exactly
 * what a fresh CI/Pages checkout deploys — a gitignored local asset (e.g. a dev
 * copy of the avatar GLB) is intentionally not flagged.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

const CAP_MIB = 20; // headroom under Cloudflare Pages' 25 MiB hard limit
const CAP_BYTES = CAP_MIB * 1024 * 1024;
const PUBLIC_DIR = "apps/web/public";

/** Repo root, so this works whatever cwd the build runs from (usually apps/web). */
function gitRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

let root;
function trackedPublicFiles() {
  try {
    root = gitRoot();
    const out = execFileSync("git", ["ls-files", "-z", PUBLIC_DIR], {
      encoding: "utf8",
      cwd: root,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    // No git (unlikely in CI): skip rather than block a legitimate build.
    console.warn("[asset-size-check] git unavailable — skipping size guard.");
    return [];
  }
}

const offenders = [];
for (const rel of trackedPublicFiles()) {
  // rel is repo-relative (apps/web/public/...). Resolve from the repo root.
  const abs = join(root, rel);
  let size = 0;
  try {
    size = statSync(abs).size;
  } catch {
    continue; // staged-deleted etc.
  }
  if (size > CAP_BYTES) offenders.push({ rel, mib: (size / 1024 / 1024).toFixed(1) });
}

if (offenders.length > 0) {
  console.error(
    `\n[asset-size-check] FAIL — ${offenders.length} committed file(s) in ${PUBLIC_DIR} exceed ${CAP_MIB} MiB:\n` +
      offenders.map((o) => `  • ${o.rel} — ${o.mib} MiB`).join("\n") +
      `\n\nCloudflare Pages rejects files > 25 MiB. Host large binaries off-repo\n` +
      `(e.g. Cloudinary) and reference them by URL (VITE_AVATAR_GLB_URL for the\n` +
      `avatar). Do NOT commit the asset.\n`,
  );
  process.exit(1);
}

console.log(`[asset-size-check] ok — no committed ${PUBLIC_DIR} file over ${CAP_MIB} MiB.`);
