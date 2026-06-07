import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowRight, MessageCircle, Scissors } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { getDetectedVerticalConfig } from "../config/verticalConfig";
import { buildBarberLoginPreview } from "../barber-app/mock-data";

export default function Login() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const vertical = getDetectedVerticalConfig();
  const isBarberLine = vertical.id === "barberline";
  const barberPreview = buildBarberLoginPreview();
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
      <div className={[
        "pointer-events-none absolute inset-0",
        isBarberLine
          ? "opacity-40 [background-image:radial-gradient(circle,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:28px_28px]"
          : "bg-[radial-gradient(closest-side_at_25%_80%,rgba(8,148,193,0.35),transparent_60%),radial-gradient(closest-side_at_70%_85%,rgba(89,224,184,0.28),transparent_60%),radial-gradient(1200px_circle_at_50%_28%,rgba(60,189,185,0.12),transparent_55%),linear-gradient(#05070C,#05070C)]",
      ].join(" ")} />
      {isBarberLine ? (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_65%_55%_at_50%_42%,rgba(24,195,126,0.10),transparent)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_40%_at_50%_100%,rgba(5,6,8,0.95),transparent),radial-gradient(ellipse_100%_40%_at_50%_0%,rgba(5,6,8,0.72),transparent)]" />
        </>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 bg-black/50" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:repeating-linear-gradient(0deg,rgba(255,255,255,0.7)_0,rgba(255,255,255,0.7)_1px,transparent_1px,transparent_3px)]" />
        </>
      )}

      <main className="relative flex min-h-screen flex-col px-4 py-10">
        <div className={[
          "mx-auto flex w-full flex-1 items-center justify-center",
          isBarberLine ? "max-w-5xl" : "max-w-md",
        ].join(" ")}>
          {isBarberLine ? (
            <section className="mr-8 hidden min-h-[580px] flex-1 rounded-3xl border border-white/[0.08] bg-white/[0.03] p-8 shadow-2xl shadow-black/45 backdrop-blur-2xl lg:flex lg:flex-col lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/20 bg-[#25D366]/[0.06] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#BDF8D1]">
                  <Scissors className="h-3.5 w-3.5" />
                  BarberLine
                </div>
                <h2 className="mt-8 max-w-sm text-4xl font-black leading-tight tracking-tight text-white">
                  {barberPreview.title}
                </h2>
                <p className="mt-4 max-w-md text-sm leading-6 text-white/62">
                  Diseñado para barberías que coordinan disponibilidad, mensajes y servicios desde WhatsApp.
                </p>
              </div>

              <div className="mt-8 grid gap-3">
                <div className="rounded-2xl border border-white/[0.07] bg-[#0E1014]/80 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-white/42">
                      <MessageCircle className="h-3.5 w-3.5 text-[#25D366]" />
                      WhatsApp
                    </div>
                    <div className="rounded-full border border-[#25D366]/20 bg-[#25D366]/10 px-2 py-0.5 text-[10px] font-bold text-[#BDF8D1]">Bot activo</div>
                  </div>
                  <div className="space-y-2">
                    {barberPreview.chat.map((message, index) => (
                      <div
                        key={`${message.speaker}-${index}`}
                        className={[
                          "max-w-[86%] rounded-2xl px-3 py-2 text-xs leading-5",
                          message.speaker === "customer"
                            ? "ml-auto rounded-br-md border border-[#25D366]/12 bg-[#25D366]/12 text-[#DDFBE8]"
                            : "rounded-bl-md border border-white/[0.06] bg-white/[0.06] text-white/78",
                        ].join(" ")}
                      >
                        {message.text}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {barberPreview.stats.map((stat) => (
                    <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-2xl font-black text-white">{stat.value}</div>
                      <div className="mt-1 text-xs text-white/52">{stat.label}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/42">Próximas citas</div>
                  <div className="space-y-2">
                    {barberPreview.upcoming.map((appointment) => (
                      <div key={`${appointment.time}-${appointment.customer}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                        <div className="w-16 shrink-0 text-sm font-black text-[#BDF8D1]">{appointment.time}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-white">{appointment.customer}</div>
                          <div className="truncate text-xs text-white/45">{appointment.service}</div>
                        </div>
                        <div className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/62">
                          {appointment.status}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null}
          <form
            onSubmit={signIn}
            className={[
              "w-full rounded-3xl border border-white/10 bg-black/35 px-6 py-8 shadow-2xl shadow-black/45 backdrop-blur-xl md:px-8 md:py-10",
              isBarberLine ? "max-w-sm border-white/[0.12] bg-white/[0.04] shadow-black/55 backdrop-blur-3xl" : "",
            ].join(" ")}
          >
            {isBarberLine ? (
              <div className="mb-6 flex flex-col items-center gap-4 text-center">
                <div className="relative">
                  <div className="absolute inset-0 scale-[1.6] rounded-[20px] bg-[#18C37E]/20 blur-2xl" />
                  <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-[18px] border border-white/[0.15] bg-[#0A0D10] shadow-2xl">
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                    <Scissors className="relative z-10 h-7 w-7 text-[#18C37E]" />
                  </div>
                </div>
                <div>
                  <h1 className="text-[32px] font-extrabold leading-none tracking-tight text-[#F0F4F8]">{vertical.brandName}</h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#5A6270]">{vertical.tagline}</p>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
                  {vertical.brandName}
                </h1>
                <div className="mt-3 h-1 w-20 rounded-full bg-gradient-to-r from-[#0894C1] via-[#3CBDB9] to-[#59E0B8]" />
                <p className="mt-4 text-sm text-white/75">{vertical.tagline}</p>
              </>
            )}

            <label htmlFor="email" className="mt-7 block text-sm font-medium text-white/85">
              Correo
            </label>
            <input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={isBarberLine ? "mt-2 h-12 w-full rounded-xl border border-white/[0.08] bg-[#05060A] px-4 text-sm text-[#E8ECF2] shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)] outline-none placeholder:text-[#252B34] transition focus:border-white/[0.16] focus:bg-[#08090E]" : "mt-2 h-12 w-full rounded-2xl border border-white/15 bg-white/10 px-4 text-base text-white placeholder:text-white/40 outline-none transition focus:border-[#3CBDB9]/70 focus:ring-4 focus:ring-[#3CBDB9]/30"}
              placeholder={vertical.emailPlaceholder}
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
              className={isBarberLine ? "mt-2 h-12 w-full rounded-xl border border-white/[0.08] bg-[#05060A] px-4 text-sm text-[#E8ECF2] shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)] outline-none placeholder:text-[#252B34] transition focus:border-white/[0.16] focus:bg-[#08090E]" : "mt-2 h-12 w-full rounded-2xl border border-white/15 bg-white/10 px-4 text-base text-white placeholder:text-white/40 outline-none transition focus:border-[#3CBDB9]/70 focus:ring-4 focus:ring-[#3CBDB9]/30"}
              placeholder="••••••••"
            />

            <button
              type="submit"
              disabled={loading}
              className={isBarberLine ? "group mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.24] bg-gradient-to-b from-white/[0.16] to-white/[0.06] text-sm font-semibold text-[#DDE3EC] shadow-[0_2px_10px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.14)] transition hover:border-[#18C37E]/40 hover:from-[#18C37E]/22 hover:to-[#18C37E]/08 hover:text-[#18C37E] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60" : "mt-6 h-12 w-full rounded-2xl bg-gradient-to-r from-[#0894C1] via-[#3CBDB9] to-[#59E0B8] text-sm font-semibold text-[#041015] transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"}
            >
              {loading ? "Entrando..." : vertical.primaryCTA}
              {isBarberLine && !loading ? <ArrowRight className="h-4 w-4 opacity-40 transition group-hover:translate-x-0.5 group-hover:opacity-100" /> : null}
            </button>

            {error && (
              <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            <p className="mt-6 text-center text-sm text-white/60">
              ¿No tienes cuenta?{" "}
              <Link to="/signup" className="font-medium text-[#59E0B8] hover:text-[#3CBDB9] transition">
                Crear cuenta
              </Link>
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
