import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

export default function BillingSuccess() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");

  useEffect(() => {
    const t = window.setTimeout(() => {
      navigate("/overview", { replace: true });
    }, 2500);
    return () => window.clearTimeout(t);
  }, [navigate]);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center">
      <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-[#59E0B8]" />
        <h1 className="mt-3 text-2xl font-semibold text-white/95">Pago confirmado</h1>
        <p className="mt-2 text-sm text-white/72">
          Tu plan ya está activo. Te redirigimos al dashboard.
        </p>
        <button
          type="button"
          onClick={() => navigate("/overview", { replace: true })}
          className="mt-4 dc-btn-primary"
        >
          Ir al dashboard
        </button>
        {sessionId ? <p className="mt-2 text-xs text-white/50">Sesión: {sessionId}</p> : null}
      </div>
    </div>
  );
}
