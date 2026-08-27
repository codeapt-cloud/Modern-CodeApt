import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default env is node (pure-logic tests). Component render tests opt into
    // jsdom per-file via a `// @vitest-environment jsdom` docblock.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
