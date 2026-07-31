/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL. Empty in dev (same-origin via the Vite proxy). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
