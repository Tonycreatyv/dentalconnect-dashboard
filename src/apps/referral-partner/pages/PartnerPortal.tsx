import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";

const SERVICE_LABELS: Record<string, string> = { luis_accidente: "Accidente de auto", luis_inmigracion: "Inmigración", luis_compra_super: "Compras de supermercado", luis_eventos: "Eventos comunitarios", luis_representante: "Hablar con asesor" };
const STATUS_LABELS: Record<string, string> = { assigned: "Asignada", accepted: "Aceptada", rejected: "Rechazada", expired: "Vencida", reassigned: "Reasignada", cancelled: "Cancelada", new: "Nueva", contacted: "Contactado", appointment_scheduled: "Cita programada", in_progress: "En progreso", converted: "Convertida", not_converted: "No convertida", closed: "Cerrada" };
const label = (value: unknown, labels: Record<string, string>) => labels[String(value ?? "")] ?? "Estado no disponible";

type Assignment = { status: string; work_status?: string | null };
type RequestDetails = { service_id?: string | null; city?: string | null; postal_code?: string | null };
type Customer = { full_name?: string | null; first_name?: string | null; last_name?: string | null; phone?: string | null };
type PortalData = { assignment: Assignment; request: RequestDetails; customer: Customer };
type PortalResponse = { success?: boolean; error?: string; assignment?: Partial<Assignment>; request?: RequestDetails; customer?: Customer };

function isPortalData(value: unknown): value is PortalData {
  if (!value || typeof value !== "object") return false;
  const row = value as PortalResponse;
  return Boolean(row.assignment && row.request && row.customer);
}

export default function PartnerPortal() {
  const { token = "" } = useParams();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (action = "view", reason = "") => {
    setBusy(true);
    const result = await supabase.functions.invoke<PortalResponse>("referral-partner-portal", { body: { token, action, reason } });
    setBusy(false);
    if (result.error || !result.data?.success) {
      setError(result.data?.error || "No se pudo abrir la oportunidad.");
      return;
    }
    if (action === "view") {
      if (!isPortalData(result.data)) {
        setError("La oportunidad no devolvió datos válidos.");
        return;
      }
      setData(result.data);
    } else {
      setData((current) => current ? { ...current, assignment: { ...current.assignment, ...result.data?.assignment } } : current);
    }
    setError("");
  }, [token]);

  useEffect(() => { void call(); }, [call]);
  if (error) return <main className="partner-portal"><h1>Acceso no disponible</h1><p>{error}</p></main>;
  if (!data) return <main className="partner-portal"><p>Cargando oportunidad…</p></main>;

  const { assignment, request, customer } = data;
  const customerName = customer.full_name || [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  return <main className="partner-portal"><header><span>Creatyv Referral Hub</span><h1>Oportunidad asignada</h1><p>Acceso limitado exclusivamente a esta asignación.</p></header><section><dl><div><dt>Servicio</dt><dd>{SERVICE_LABELS[String(request.service_id ?? "")] ?? "Servicio comunitario"}</dd></div><div><dt>Cliente</dt><dd>{customerName || "No disponible"}</dd></div><div><dt>Contacto</dt><dd>{customer.phone || "No disponible"}</dd></div><div><dt>Área</dt><dd>{request.city || request.postal_code || "No disponible"}</dd></div><div><dt>Estado</dt><dd>{label(assignment.status, STATUS_LABELS)} · {label(assignment.work_status, STATUS_LABELS)}</dd></div></dl></section><section className="partner-actions"><button disabled={busy || assignment.status !== "assigned"} onClick={() => void call("accept")}>Aceptar</button><button disabled={busy || assignment.status !== "assigned"} onClick={() => { const reason = prompt("Motivo del rechazo"); if (reason) void call("reject", reason); }}>Rechazar</button>{["contacted", "appointment_scheduled", "in_progress", "converted", "not_converted", "closed"].map((status) => <button key={status} disabled={busy || assignment.status !== "accepted"} onClick={() => void call(status)}>{label(status, STATUS_LABELS)}</button>)}</section></main>;
}
