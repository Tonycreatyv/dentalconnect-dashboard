import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import BrandMark from "../components/BrandMark";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) setError("No se pudo iniciar sesión. Revisa correo y contraseña.");
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#070A12]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4">
        <div className="grid w-full grid-cols-1 gap-10 lg:grid-cols-2">
          <div className="hidden lg:block">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
              <BrandMark clinicName="Panel" />
              <h1 className="mt-6 text-3xl font-semibold text-white">
                DentalConnect
              </h1>
              <p className="mt-3 text-white/60">
                Inbox + Agenda + Seguimientos. Todo en un panel simple para clínicas.
              </p>

              <div className="mt-8 grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
                  ✅ Responde mensajes rápido (Messenger/IG/WhatsApp)
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
                  ✅ Agenda y pipeline por estados (drag & drop)
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
                  ✅ Follow-ups automáticos y sin perder leads
                </div>
              </div>
            </div>
          </div>

          <div>
            <form
              onSubmit={signIn}
              className="rounded-3xl border border-white/10 bg-white/[0.03] p-8"
            >
              <h2 className="text-2xl font-semibold text-white">Iniciar sesión</h2>
              <p className="mt-2 text-sm text-white/60">
                Entrá al panel de tu clínica.
              </p>

              {error ? (
                <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                  {error}
                </div>
              ) : null}

              <label className="mt-6 block text-xs font-medium text-white/60">
                Correo
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none focus:border-white/25"
                placeholder="tu@clinica.com"
              />

              <label className="mt-4 block text-xs font-medium text-white/60">
                Contraseña
              </label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none focus:border-white/25"
                placeholder="••••••••"
              />

              <button
                type="submit"
                disabled={loading}
                className="mt-6 h-11 w-full rounded-2xl bg-white text-sm font-semibold text-black hover:opacity-95 disabled:opacity-60"
              >
                {loading ? "Entrando..." : "Entrar"}
              </button>

              <p className="mt-4 text-xs text-white/45">
                Si estás en demo, usá el usuario que tengas creado en Supabase Auth.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}