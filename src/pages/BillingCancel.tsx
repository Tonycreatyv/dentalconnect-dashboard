import { useNavigate } from "react-router-dom";
import { AlertCircle } from "lucide-react";

export default function BillingCancel() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center">
      <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-amber-300" />
        <h1 className="mt-3 text-2xl font-semibold text-white/95">Pago cancelado</h1>
        <p className="mt-2 text-sm text-white/72">
          No se realizó ningún cobro. Podés volver a intentarlo cuando quieras.
        </p>
        <button type="button" onClick={() => navigate("/billing")} className="mt-5 dc-btn-primary">
          Volver a Billing
        </button>
      </div>
    </div>
  );
}
