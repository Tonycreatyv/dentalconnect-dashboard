import { ArrowLeft, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MobileEmptyState, MobileHeader } from "../../components/mobile/MobilePrimitives";
import { leadName } from "../../referral/status";
import { useReferralData } from "../../referral/useReferralData";
import type { ReferralStatus } from "../../referral/types";
import { ReferralLoading } from "./ReferralHome";

export default function ReferralQualification() {
  const { leadId } = useParams(); const navigate = useNavigate(); const data = useReferralData(); const [confirming, setConfirming] = useState<ReferralStatus | null>(null); const [busy, setBusy] = useState(false);
  const lead = data.leads.find((item) => item.id === leadId);
  if (data.loading) return <ReferralLoading />;
  if (!lead) return <main className="referral-page"><MobileEmptyState title="Lead no encontrado" description="No existe o no pertenece a esta organización." /></main>;
  const activeLead = lead;
  const answers = Object.entries(activeLead.extracted_data ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== "");
  async function commit(status: ReferralStatus) { setBusy(true); const result = await data.updateStatus(activeLead.id, status); setBusy(false); if (result.ok) navigate(`/leads/${activeLead.id}`, { replace: true }); }
  return <main className="referral-page referral-page-with-actions"><button className="referral-back" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" />Volver</button><MobileHeader eyebrow="Calificación" title={leadName(lead)} subtitle="Revisa lo recopilado antes de decidir" />
    <section className="referral-panel"><div className="referral-section-heading"><div><p className="referral-eyebrow">Información disponible</p><h2>Respuestas</h2></div><span className="text-xs text-[#748291]">{answers.length}</span></div>{answers.length ? <div className="divide-y divide-white/[0.06]">{answers.map(([key, value]) => <div key={key} className="py-3"><p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#748291]">{key.replace(/_/g, " ")}</p><p className="mt-1 break-words text-sm leading-6 text-[#EAF0F5]">{typeof value === "object" ? JSON.stringify(value) : String(value)}</p></div>)}</div> : <div className="referral-empty-compact"><AlertTriangle className="h-4 w-4" />No hay respuestas capturadas. Confirma la información directamente con el lead.</div>}</section>
    <div className="referral-sticky-actions"><p className="mb-3 text-center text-xs text-[#7E8C99]">Esta decisión actualizará el estado del lead.</p><div className="grid grid-cols-2 gap-2"><button disabled={busy} onClick={() => setConfirming("not_qualified")} className="referral-secondary-button text-rose-200"><XCircle className="h-4 w-4" />No califica</button><button disabled={busy} onClick={() => setConfirming("qualified")} className="referral-primary-button"><CheckCircle2 className="h-4 w-4" />Calificado</button></div></div>
    {confirming ? <div className="referral-confirm-overlay"><div className="referral-confirm-card"><h2>Confirmar decisión</h2><p>{confirming === "qualified" ? "Marcar este lead como calificado." : "Marcar este lead como no califica."}</p><div className="mt-5 grid grid-cols-2 gap-2"><button className="referral-secondary-button" onClick={() => setConfirming(null)}>Cancelar</button><button className={confirming === "qualified" ? "referral-primary-button" : "referral-danger-button"} onClick={() => void commit(confirming)}>Confirmar</button></div></div></div> : null}
  </main>;
}
