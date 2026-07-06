import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Clock, Handshake, MessageCircle, User } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { getDetectedVerticalConfig } from "../config/verticalConfig";

const ACCENT = "#25D366";

const previewRows = [
  { label: "Nuevos", value: "12", accent: true },
  { label: "Aliados", value: "4", accent: false },
];

const previewRequests = [
  { time: "9:12", name: "Accidente de Auto", detail: "Código listo" },
  { time: "9:28", name: "Inmigración", detail: "Solicitud calificada" },
  { time: "10:05", name: "Cupón médico", detail: "Enviado al aliado" },
];

export default function Login() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const vertical = getDetectedVerticalConfig();
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
    <div className="relative flex min-h-screen overflow-hidden bg-[#050608] text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_65%_55%_at_50%_42%,rgba(37,211,102,0.10),transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_40%_at_50%_100%,rgba(5,6,8,0.95),transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_40%_at_50%_0%,rgba(5,6,8,0.7),transparent)]" />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-5">
            <div className="relative">
              <div className="absolute inset-0 scale-[1.6] rounded-[20px] blur-2xl" style={{ backgroundColor: `${ACCENT}33` }} />
              <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-[18px] shadow-2xl">
                <div className="absolute inset-0 bg-[#0A0D10]" />
                <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />
                <div className="absolute inset-0 rounded-[18px] border border-white/[0.15]" />
                <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                <Handshake className="relative z-10 h-7 w-7" style={{ color: ACCENT }} />
              </div>
            </div>
            <div className="text-center">
              <h1 className="text-[32px] font-extrabold leading-none tracking-tight text-[#F0F4F8]">
                {vertical.brandName}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[#5A6270]">
                {vertical.tagline}
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl">
            <div className="absolute inset-0 bg-white/[0.04] backdrop-blur-3xl" />
            <div className="absolute inset-0 rounded-2xl border border-white/[0.12]" />
            <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/30 to-transparent" />

            <div className="relative z-10 space-y-5 p-6">
              <form onSubmit={signIn} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#4A5260]">
                    Correo
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder={vertical.emailPlaceholder}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    className="w-full rounded-xl border border-white/[0.08] bg-[#05060A] px-4 py-3 text-sm text-[#E8ECF2] shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)] transition-all duration-150 placeholder:text-[#252B34] focus:border-white/[0.16] focus:bg-[#08090E] focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="password" className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#4A5260]">
                    Contraseña
                  </label>
                  <input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-white/[0.08] bg-[#05060A] px-4 py-3 text-sm text-[#E8ECF2] shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)] transition-all duration-150 placeholder:text-[#252B34] focus:border-white/[0.16] focus:bg-[#08090E] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.24] bg-gradient-to-b from-white/[0.16] to-white/[0.06] py-3 text-sm font-semibold text-[#DDE3EC] shadow-[0_2px_10px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.14)] transition-all duration-200 hover:text-[#25D366] hover:shadow-[0_0_28px_rgba(37,211,102,0.14),0_2px_10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(37,211,102,0.22)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#25D366]/30 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Entrando..." : vertical.primaryCTA}
                  {!loading ? <ArrowRight className="h-4 w-4 opacity-40 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" /> : null}
                </button>
              </form>

              {error ? (
                <p className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center gap-2.5 rounded-lg border border-[#25D366]/[0.10] bg-[#25D366]/[0.06] px-3 py-2">
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#25D366]" />
                <p className="text-[11px] leading-none text-[#4A5260]">
                  Conectado a WhatsApp Business para operar solicitudes.
                </p>
              </div>

              <p className="text-center text-xs text-[#4A5260]">
                ¿No tienes cuenta?{" "}
                <Link to="/signup" className="font-semibold text-[#25D366] transition hover:text-[#BDF8D1]">
                  Crear cuenta
                </Link>
              </p>
            </div>
          </div>

          <p className="mt-6 text-center text-[11px] text-[#252B34]">Powered by Creatyv</p>
        </div>
      </div>

      <div className="relative z-10 hidden flex-1 items-center justify-center border-l border-white/[0.05] p-12 lg:flex">
        <div className="w-full max-w-[340px] space-y-4">
          <div className="mb-6 text-center">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#252B34]">Vista previa</p>
            <p className="text-xl font-bold tracking-tight text-[#F0F4F8]">Referidos, organizados</p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-xl">
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-3.5 py-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#25D366]">
                <MessageCircle className="h-3.5 w-3.5 fill-white text-white" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold text-[#E8ECF2]">Luis Gabriel</p>
                <p className="text-[10px] text-[#25D366]">En línea</p>
              </div>
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#25D366]" />
            </div>
            <div className="space-y-2 p-3">
              <div className="flex justify-start">
                <div className="max-w-[76%] rounded-xl rounded-tl-sm border border-white/[0.06] bg-white/[0.06] px-3 py-2">
                  <p className="text-xs text-[#C8D0DC]">Tuve un accidente de auto.</p>
                  <p className="mt-0.5 text-[10px] text-[#353D4A]">10:10 AM</p>
                </div>
              </div>
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-xl rounded-tr-sm border border-[#25D366]/[0.14] bg-[#25D366]/[0.10] px-3 py-2">
                  <p className="text-xs text-[#C8D0DC]">Gracias. Luis Gabriel ya recibió tu solicitud.</p>
                  <p className="mt-0.5 text-[10px] text-[#353D4A]">10:12 AM · Referral Hub</p>
                </div>
              </div>
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-xl rounded-tr-sm border border-[#25D366]/[0.10] bg-[#25D366]/[0.08] px-3 py-2">
                  <p className="text-xs text-[#C8D0DC]">🎟️ Código creado · Aliado asignado</p>
                  <p className="mt-0.5 text-[10px] text-[#353D4A]">10:12 AM · Referral Hub</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {previewRows.map((item) => (
              <div key={item.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 backdrop-blur-sm">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#353D4A]">{item.label}</p>
                <p className={item.accent ? "text-2xl font-bold text-[#25D366]" : "text-2xl font-bold text-[#F0F4F8]"}>{item.value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3.5 backdrop-blur-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#252B34]">Solicitudes recientes</p>
            {previewRequests.map((request, index) => (
              <div key={request.time} className="flex items-center gap-3">
                <span className="w-10 flex-shrink-0 font-mono text-xs text-[#353D4A]">{request.time}</span>
                <div className="h-5 w-px flex-shrink-0 bg-white/[0.06]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-[#C0C8D4]">{request.name}</p>
                  <p className="truncate text-[10px] text-[#353D4A]">{request.detail}</p>
                </div>
                {index === 0 ? (
                  <span className="flex-shrink-0 rounded-full bg-[#25D366]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#25D366]">
                    NUEVO
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-6 pt-1">
            {[
              { icon: <MessageCircle className="h-3.5 w-3.5" />, label: "WhatsApp" },
              { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Códigos" },
              { icon: <Clock className="h-3.5 w-3.5" />, label: "Estados" },
              { icon: <User className="h-3.5 w-3.5" />, label: "Aliados" },
            ].map((feature) => (
              <div key={feature.label} className="flex flex-col items-center gap-1.5 text-[#252B34]">
                {feature.icon}
                <span className="text-[9px] font-semibold tracking-wide">{feature.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
