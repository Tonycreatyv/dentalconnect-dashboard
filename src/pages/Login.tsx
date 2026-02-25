import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (session) navigate("/overview", { replace: true });
  }, [session, authLoading, navigate]);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setError("No se pudo iniciar sesión. Revisa correo y contraseña.");
      setLoading(false);
      return;
    }

    setLoading(false);
    navigate("/overview", { replace: true });
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05070C] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(closest-side_at_25%_80%,rgba(8,148,193,0.35),transparent_60%),radial-gradient(closest-side_at_70%_85%,rgba(89,224,184,0.28),transparent_60%),radial-gradient(1200px_circle_at_50%_28%,rgba(60,189,185,0.12),transparent_55%),linear-gradient(#05070C,#05070C)]" />
      <div className="pointer-events-none absolute inset-0 bg-black/50" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:repeating-linear-gradient(0deg,rgba(255,255,255,0.7)_0,rgba(255,255,255,0.7)_1px,transparent_1px,transparent_3px)]" />

      <main className="relative flex min-h-screen flex-col px-4 py-10">
        <div className="mx-auto flex w-full max-w-md flex-1 items-center justify-center">
          <form
            onSubmit={signIn}
            className="w-full rounded-3xl border border-white/10 bg-black/35 px-6 py-8 shadow-2xl shadow-black/45 backdrop-blur-xl md:px-8 md:py-10"
          >
            <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
              DentalConnect
            </h1>
            <div className="mt-3 h-1 w-20 rounded-full bg-gradient-to-r from-[#0894C1] via-[#3CBDB9] to-[#59E0B8]" />
            <p className="mt-4 text-sm text-white/75">Entrá al panel de tu clínica.</p>

            <label htmlFor="email" className="mt-7 block text-sm font-medium text-white/85">
              Correo
            </label>
            <input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="mt-2 h-12 w-full rounded-2xl border border-white/15 bg-white/10 px-4 text-base text-white placeholder:text-white/40 outline-none transition focus:border-[#3CBDB9]/70 focus:ring-4 focus:ring-[#3CBDB9]/30"
              placeholder="tu@clinica.com"
            />

            <label htmlFor="password" className="mt-4 block text-sm font-medium text-white/85">
              Contraseña
            </label>
            <input
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              className="mt-2 h-12 w-full rounded-2xl border border-white/15 bg-white/10 px-4 text-base text-white placeholder:text-white/40 outline-none transition focus:border-[#3CBDB9]/70 focus:ring-4 focus:ring-[#3CBDB9]/30"
              placeholder="••••••••"
            />

            <button
              type="submit"
              disabled={loading}
              className="mt-6 h-12 w-full rounded-2xl bg-gradient-to-r from-[#0894C1] via-[#3CBDB9] to-[#59E0B8] text-sm font-semibold text-[#041015] transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>

            {error ? (
              <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            ) : null}
          </form>
        </div>

        <footer className="pt-6 text-center text-xs text-white/55">
          Powered by <span className="font-semibold text-[#59E0B8]">CREATYV</span>
        </footer>
      </main>
    </div>
  );
}
