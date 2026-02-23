import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

export const hasSupabaseEnv = Boolean(url && anon);

/**
 * Nota:
 * - Supabase anon key NO es secreto (es “public”), pero Netlify puede bloquearlo por scanner.
 * - Si faltan env vars, igual creamos un client “dummy” para que la UI no reviente.
 *   (Auth fallará, pero no crashea la app completa).
 */
export const supabase = createClient(
  hasSupabaseEnv ? url : "http://localhost",
  hasSupabaseEnv ? anon : "public-anon-key"
);
