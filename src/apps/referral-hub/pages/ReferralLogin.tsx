import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";

export default function ReferralLogin() {
  const { session, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (session) return <Navigate to="/" replace />;
  return (
    <main className="min-h-screen bg-[#071018] px-5 py-16 text-white">
      <form className="mx-auto max-w-sm rounded-3xl border border-white/10 bg-[#0d1821] p-6" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true); setError("");
        try {
          const message = await signIn(email, password);
          if (message) setError(message);
        } catch (reason) {
          setError(String((reason as Error)?.message || "No se pudo iniciar sesión."));
        } finally { setBusy(false); }
      }}>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#25D366]">Creatyv Referral Hub</p>
        <h1 className="mt-2 text-2xl font-black">LG Community Network</h1>
        <p className="mt-2 text-sm text-white/60">Accede al panel de referidos y Messenger.</p>
        <label className="mt-6 block text-xs text-white/60">Correo</label>
        <input className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="mt-4 block text-xs text-white/60">Contraseña</label>
        <input className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        <button className="mt-6 w-full rounded-xl bg-[#25D366] px-4 py-3 font-bold text-[#062810]" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}
