import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { resolveLoginReturnPath } from "../auth/loginNavigation";
import ConexxionWordmark from "../ui/ConexxionWordmark";

export default function ReferralLogin() {
  const { session, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (session) return <Navigate to={resolveLoginReturnPath(location.state)} replace />;
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-5 py-16 text-[#1C1917]">
      <form className="mx-auto max-w-sm rounded-3xl border border-[#E8E4DD] bg-white p-6 shadow-[0_1px_2px_rgba(28,25,23,.04),0_1px_1px_rgba(28,25,23,.03)]" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true); setError("");
        try {
          const message = await signIn(email, password);
          if (message) setError("No pudimos iniciar sesión. Revisa tu correo y contraseña.");
        } catch (reason) {
          setError(String((reason as Error)?.message || "No se pudo iniciar sesión."));
        } finally { setBusy(false); }
      }}>
        <ConexxionWordmark className="text-xl is-dark-on-light" />
        <h1 className="mt-2 text-2xl font-black">LG Community Network</h1>
        <p className="mt-2 text-sm text-[#79746D]">Accede al panel de LG Community Network.</p>
        <label className="mt-6 block text-xs text-[#79746D]" htmlFor="conexxion-email">Correo electrónico</label>
        <input id="conexxion-email" className="mt-2 w-full rounded-xl border border-[#E8E4DD] bg-[#FAF9F6] px-4 py-3" type="email" autoComplete="email" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} required />
        <label className="mt-4 block text-xs text-[#79746D]" htmlFor="conexxion-password">Contraseña</label>
        <div className="mt-2 flex overflow-hidden rounded-xl border border-[#E8E4DD] bg-[#FAF9F6] focus-within:border-[#0D9268]">
          <input id="conexxion-password" className="min-w-0 flex-1 bg-transparent px-4 py-3 outline-none" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <button className="px-4 text-xs font-bold text-[#57534E]" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? "Ocultar" : "Mostrar"}</button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600" role="alert">{error}</p> : null}
        <button className="mt-6 min-h-12 w-full rounded-xl bg-[#0D9268] px-4 py-3 font-bold text-white" disabled={busy}>{busy ? "Entrando…" : "Iniciar sesión"}</button>
      </form>
    </main>
  );
}
