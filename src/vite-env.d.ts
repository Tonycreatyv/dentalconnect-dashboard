/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_RUN_REPLIES_SECRET?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_META_APP_ID?: string;
  readonly VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
