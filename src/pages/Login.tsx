import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Stethoscope } from "lucide-react";

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = useMemo(() => {
    const st = location.state as any;
    return st?.from?.pathname ?? "/";
  }, [location.state]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const err = await signIn(email.trim(), password);
    setBusy(false);

    if (err) {
      setError(err);
      return;
    }

    navigate(redirectTo, { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#0a0f14] text-white">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 lg:grid-cols-2">
        {/* Left: brand */}
        <div className="relative hidden lg:flex flex-col justify-between p-10">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
          <div className="absolute inset-0 opacity-60">
            <div className="h-full w-full bg-[radial-gradient(ellipse_at_top,rgba(32,195,176,0.18),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(45,212,255,0.10),transparent_55%)]" />
          </div>

          <div className="relative z-10">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
                <Stethoscope className="h-5 w-5 text-teal-300" />
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold tracking-[0.26em] uppercase">DentalConnect</p>
                <p className="text-[11px] tracking-[0.18em] uppercase text-white/55">by Creatyv</p>
              </div>
            </div>

            <h1 className="mt-10 text-4xl font-semibold leading-tight">
              Inbox clínico, <span className="text-white/70">citas</span> y{" "}
              <span className="text-white/70">follow-ups</span>.
            </h1>
            <p className="mt-4 max-w-md text-white/65 leading-relaxed">
              Automatiza mensajes en WhatsApp/Messenger/IG y deja todo organizado para tu equipo.
            </p>
          </div>

          <div className="relative z-10 text-xs text-white/45 tracking-[0.14em] uppercase">
            © {new Date().getFullYear()} Creatyv
          </div>
        </div>

        {/* Right: form */}
        <div className="flex items-center justify-center px-5 py-10 lg:px-10">
          <div className="w-full max-w-md">
            <div className="lg:hidden mb-8">
              <p className="text-[11px] tracking-[0.26em] uppercase text-white/60">DentalConnect</p>
              <p className="text-2xl font-semibold mt-2">Iniciar sesión</p>
              <p className="text-sm text-white/60 mt-2">
                Accede a tu inbox y la configuración de tu clínica.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-card">
              <div className="hidden lg:block mb-6">
                <p className="text-[11px] tracking-[0.26em] uppercase text-white/60">Iniciar sesión</p>
                <p className="text-2xl font-semibold mt-2">DentalConnect</p>
                <p className="text-sm text-white/60 mt-2">
                  Accede a tu inbox y la configuración de tu clínica.
                </p>
              </div>

              <form className="grid gap-3" onSubmit={onSubmit}>
                <label className="grid gap-2">
                  <span className="text-[10px] tracking-[0.22em] uppercase text-white/60">Email</span>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    required
                    className="h-12 rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                    placeholder="tu@email.com"
                    autoComplete="email"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-[10px] tracking-[0.22em] uppercase text-white/60">Contraseña</span>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    required
                    className="h-12 rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </label>

                {error ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={busy}
                  className="mt-1 h-12 rounded-2xl bg-white text-black font-semibold tracking-[0.06em] hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed transition"
                >
                  {busy ? "Entrando..." : "Entrar"}
                </button>

                <div className="mt-2 flex items-center justify-between text-xs text-white/60">
                  <span>
                    ¿No tenés cuenta?{" "}
                    <Link to="/register" className="text-white hover:underline">
                      Crear cuenta
                    </Link>
                  </span>
                </div>
              </form>
            </div>

            <p className="mt-6 text-center text-[11px] tracking-[0.18em] uppercase text-white/40">
              Modern. Clean. Clinic-ready.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
