// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

/**
 * Single shared flat config for the whole monorepo.
 * Path-scoped blocks apply the right environment (Node vs browser/React)
 * without duplicating rules across apps.
 */
export default tseslint.config(
  {
    // Never lint build output, deps, or generated/vendored assets.
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.d.ts",
      // Vendored, self-hosted static assets served as-is (e.g. the MediaPipe
      // WASM glue in apps/web/public/mediapipe) — not our source.
      "**/public/**",
    ],
  },

  // Base JS + TS recommended rules for every source file.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Allow intentionally-unused args/vars when prefixed with `_`.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },

  // Node services: api, worker, shared, and root config/tooling files.
  {
    files: [
      "apps/api/**/*.ts",
      "apps/worker/**/*.ts",
      "packages/shared/**/*.ts",
      "**/*.config.{js,mjs,cjs,ts}",
      "**/scripts/**/*.{js,mjs,cjs}",
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // React web app.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // The design-system library and providers intentionally co-export components
  // with hooks, contexts, and cva variants, so the fast-refresh purity rule
  // (an HMR-granularity nicety) doesn't apply there.
  {
    files: [
      "apps/web/src/components/**/*.{ts,tsx}",
      "apps/web/src/providers/**/*.{ts,tsx}",
    ],
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Turn off formatting-related rules that conflict with Prettier. Keep last.
  prettier,
);
