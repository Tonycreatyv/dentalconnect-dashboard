import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const token = searchParams.get("token");

  async function handleSignup(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    setLoading(true);

    // 1. Crear cuenta
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { signup_token: token },
      },
    });

    if (signUpError) {
      setError(signUpError.message || "No se pudo crear la cuenta.");
      setLoading(false);
      return;
    }

    // 2. Si Supabase devolvió sesión, ya estamos logueados
    if (signUpData.session) {
      navigate("/onboarding", { replace: true });
      return;
    }

    // 3. Si no hay sesión (email confirmation habilitado), intentar login directo
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      // Probablemente necesita confirmar email
      setSuccess(true);
      setLoading(false);
      return;
    }

    if (signInData.session) {
      navigate("/onboarding", { replace: true });
      return;
    }

    // Fallback: mostrar éxito
    setSuccess(true);
    setLoading(false);
  }

  async function handleGoogleSignup() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/onboarding` },
    });
    if (error) setError(error.message);
    setLoading(false);
  }

  // Mostrar mensaje de éxito si necesita confirmar email
  if (success) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-[#05070C] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(closest-side_at_25%_80%,rgba(8,148,193,0.35),transparent_60%),radial-gradient(closest-side_at_70%_85%,rgba(89,224,184,0.28),transparent_60%),radial-gradient(1200px_circle_at_50%_28%,rgba(60,189,185,0.12),transparent_55%),linear-gradient(#05070C,#05070C)]" />
        <div className="pointer-events-none absolute inset-0 bg-black/50" />
        
        <main className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/35 px-6 py-10 text-center shadow-2xl shadow-black/45 backdrop-blur-xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-r from-[#0894C1] to-[#59E0B8]">
              <svg className="h-8 w-8 text-[#041015]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-6 text-2xl font-semibold">¡Cuenta creada!</h2>
            <p className="mt-3 text-white/70">
              Revisa tu email ({email}) para confirmar tu cuenta.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block rounded-2xl bg-gradient-to-r from-[#0894C1] via-[#3CBDB9] to-[#59E0B8] px-8 py-3 text-sm font-semibold text-[#041015] transition hover:brightness-110"
            >
              Ir a Iniciar Sesión
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05070C] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(closest-side_at_25%_80%,rgba(8,148,193,0.35),transparent_60%),radial-gradient(closest-side_at_70%_85%,rgba(89,224,184,0.28),transparent_60%),radial-gradient(1200px_circle_at_50%_28%,rgba(60,189,185,0.12),transparent_55%),linear-gradient(#05070C,#05070C)]" />
      <div className="pointer-events-none absolute inset-0 bg-black/50" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:repeating-linear-gradient(0deg,rgba(255,255,255,0.7)_0,rgba(255,255,255,0.7)_1px,transparent_1px,transparent_3px)]" />

      <main className="relative flex min-h-screen flex-col px-4 py-10">
        <div className="mx-auto flex w-full max-w-md flex-1 items-center justify-center">
          <form
            onSubmit={handleSignup}
            className="w-full rounded-3xl border border-white/10 bg-black/35 px-6 py-8 shadow-2xl shadow-black/45 backdrop-blur-xl md:px-8 md:py-10"
          >
            <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
              DentalConnect
            </h1>
            <div className="mt-3 h-1 w-20 rounded-full bg-gradient-to-r from-[#0894C1] via-[#3CBDB9] to-[#59E0B8]" />
            <p className="mt-4 text-sm text-white/75">Crea tu cuenta y comienza tu trial de 14 días.</p>

            <button
              type="button"
              onClick={handleGoogleSignup}
              disabled={loading}
              className="mt-7 flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-white/15 bg-white/10 text-sm font-medium text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continuar con Google
            </button>

            <div className="mt-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-white/15" />
              <span className="text-xs text-white/50">o con email</span>
              <div className="h-px flex-1 bg-white/15" />
            </div>

            <label htmlFor="email" className="mt-6 block text-sm font-medium text-white/85">
              Correo
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-2 h-12 w-full rounded-2xl border border-white/15 bg-white/10 px-4 text-base text-white placeholder:text-white/40 outline-none transition focus:border-[#3CBDB9]/70 focus:ring-4 focus:ring-[#3CBDB9]/30"
              placeholder="tu@clinica.com"
            />

            <label htmlFor="password" className="mt-4 block text-sm font-medium text-white/85">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="mt-2 h-12 w-full rounded-2xl border border-white/15 bg-white/10 px-4 text-base text-white placeholder:text-white/40 outline-none transition focus:border-[#3CBDB9]/70 focus:ring-4 focus:ring-[#3CBDB9]/30"
              placeholder="Mínimo 8 caracteres"
            />

            <label htmlFor="confirmPassword" className="mt-4 block text-sm font-medium text-white/85">
              Confirmar contraseña
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="mt-2 h-12 w-full rounded-2xl border border-white/15 bg-white/10 px-4 text-base text-white placeholder:text-white/40 outline-none transition focus:border-[#3CBDB9]/70 focus:ring-4 focus:ring-[#3CBDB9]/30"
              placeholder="Repite tu contraseña"
            />

            <button
              type="submit"
              disabled={loading}
              className="mt-6 h-12 w-full rounded-2xl bg-gradient-to-r from-[#0894C1] via-[#3CBDB9] to-[#59E0B8] text-sm font-semibold text-[#041015] transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Creando cuenta..." : "Crear cuenta"}
            </button>

            {error && (
              <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            <p className="mt-6 text-center text-sm text-white/60">
              ¿Ya tienes cuenta?{" "}
              <Link to="/login" className="font-medium text-[#59E0B8] hover:text-[#3CBDB9] transition">
                Iniciar sesión
              </Link>
            </p>

            <p className="mt-4 text-center text-xs text-white/40">
              🎉 Trial gratuito de 14 días • Sin tarjeta de crédito
            </p>
          </form>
        </div>

        <footer className="pt-6 text-center text-xs text-white/55">
          Powered by <span className="font-semibold text-[#59E0B8]">CREATYV</span>
        </footer>
      </main>
    </div>
  );
}
