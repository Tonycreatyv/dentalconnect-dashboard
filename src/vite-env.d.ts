/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_RUN_REPLIES_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
