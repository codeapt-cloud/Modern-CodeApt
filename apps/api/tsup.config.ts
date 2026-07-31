import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
