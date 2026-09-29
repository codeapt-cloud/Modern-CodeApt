import { defineConfig } from "tsup";

export default defineConfig({
  // The server entry PLUS the standalone operator scripts, so they ship in the
  // prod image as `dist/scripts/*.js` runnable with `node` (the runtime image is
  // a pruned --prod deploy with NO devDeps, so `tsx` is absent there). The npm
  // `gateway:*` scripts still use tsx for local dev; in a container run e.g.
  // `node dist/scripts/refresh-provider-models.js`.
  entry: [
    "src/index.ts",
    "src/scripts/refresh-provider-models.ts",
    "src/scripts/gateway-healthcheck.ts",
  ],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle the workspace `@codeapt/shared` package (which resolves to TS
  // source) into the output so `node dist/index.js` is self-contained.
  noExternal: ["@codeapt/shared"],
});
