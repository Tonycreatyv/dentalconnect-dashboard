import { ArrowLeft, CheckCircle2, CircleOff, Package } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

type IntakeObjective = { label?: string; name?: string; key?: string; required?: boolean };
type ServiceConfig = {
  id: string;
  nombre: string | null;
  menu_label: string | null;
  activo: boolean | null;
  tipo: string | null;
  intake_objectives: IntakeObjective[] | null;
};

function behaviorLabel(type: string | null) {
  if (type === "static_action") return "Respuesta y acción automática";
  if (type === "transfer") return "Transferencia a representante";
  if (type === "intake") return "Recopila información antes de continuar";
  return "No configurado";
}

function objectiveLabel(objective: IntakeObjective) {
  const value = objective.label || objective.name || objective.key || "Dato requerido";
  return value.replace(/_/g, " ").replace(/^./, (letter: string) => letter.toUpperCase());
}

export default function ReferralServiceDetail() {
  const { serviceId = "" } = useParams();
  const { resolvedOrgId } = useReferralOrganization();
  const [service, setService] = useState<ServiceConfig | null>(null);
  const [allyCount, setAllyCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!resolvedOrgId || !serviceId) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void Promise.all([
      supabase.from("service_configs")
        .select("id,nombre,menu_label,activo,tipo,intake_objectives")
        .eq("organization_id", resolvedOrgId).eq("id", serviceId).maybeSingle(),
      supabase.from("referral_partner_service_rules").select("id")
        .eq("organization_id", resolvedOrgId).eq("service_id", serviceId).eq("active", true),
    ]).then(([serviceResult, alliesResult]) => {
      if (!active) return;
      setService((serviceResult.data as ServiceConfig | null) ?? null);
      setAllyCount(alliesResult.error ? null : (alliesResult.data ?? []).length);
      setError(serviceResult.error ? "No se pudo cargar el servicio." : "");
      setLoading(false);
    });
    return () => { active = false; };
  }, [resolvedOrgId, serviceId]);

  if (loading) return <main className="mx-auto max-w-[880px] py-12 text-center text-sm text-[#8B9098]" role="status">Cargando servicio…</main>;
  if (error || !service) return <main className="mx-auto max-w-[880px]"><Link className="referral-bolt-back" to="/services"><ArrowLeft />Servicios</Link><div className="referral-bolt-empty" role="alert">{error || "Servicio no encontrado."}</div></main>;

  const objectives = Array.isArray(service.intake_objectives) ? service.intake_objectives : [];
  const routing = service.tipo === "transfer"
    ? "Transfiere la conversación a un representante."
    : service.tipo === "static_action"
    ? "Ejecuta la respuesta configurada sin asignación manual."
    : "No configurado";

  return (
    <main className="referral-bolt-page referral-service-detail">
      <Link className="referral-bolt-back" to="/services"><ArrowLeft />Servicios</Link>
      <header className="referral-bolt-detail-header">
        <span className="referral-bolt-icon"><Package /></span>
        <div><h1>{service.menu_label || service.nombre || "Servicio sin nombre"}</h1><p>{behaviorLabel(service.tipo)}</p></div>
        <span className={`referral-bolt-badge ${service.activo ? "is-success" : ""}`}>
          {service.activo ? <CheckCircle2 /> : <CircleOff />}{service.activo ? "Activo" : "Inactivo"}
        </span>
      </header>
      <section className="referral-bolt-section">
        <h2>Configuración avanzada</h2>
        <dl className="referral-bolt-facts">
          <div><dt>Comportamiento</dt><dd>{behaviorLabel(service.tipo)}</dd></div>
          <div><dt>Enrutamiento</dt><dd>{routing}</dd></div>
          {allyCount !== null ? <div><dt>Aliados compatibles</dt><dd>{allyCount}</dd></div> : null}
        </dl>
      </section>
      <section className="referral-bolt-section">
        <h2>Información requerida</h2>
        {objectives.length ? <ul className="referral-bolt-requirements">{objectives.map((objective, index) => <li key={`${objectiveLabel(objective)}-${index}`}><span>{objectiveLabel(objective)}</span><small>{objective.required === false ? "Opcional" : "Requerido"}</small></li>)}</ul> : <p className="referral-bolt-muted">No configurado</p>}
      </section>
    </main>
  );
}
