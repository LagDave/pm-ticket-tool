/// <reference types="vite/client" />

/** Typed public env (§17.3) — only VITE_-prefixed config reaches the bundle. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
