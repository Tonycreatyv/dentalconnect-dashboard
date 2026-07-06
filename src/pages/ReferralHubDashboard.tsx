import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Clock, Handshake, Loader2, MessageCircle, MoreHorizontal, Phone, RefreshCcw, Search, Send, UserCheck, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { MobileActionButton, MobileBottomSheet, MobileCard, MobileEmptyState, MobileHeader, MobileStatusPill } from "../components/mobile/MobilePrimitives";
import { getDetectedVerticalConfig } from "../config/verticalConfig";
import { useAuth } from "../context/AuthContext";

const REFERRAL_ORG_ID = "insurance-demo";

const STATUS_COLUMNS = [
  { value: "new", label: "Nuevo" },
  { value: "contacted", label: "Contactado" },
  { value: "qualified", label: "Calificado" },
  { value: "sent_to_partner", label: "Enviado al aliado" },
  { value: "closed", label: "Cerrado" },
  { value: "not_qualified", label: "No califica" },
] as const;

type ReferralStatus = typeof STATUS_COLUMNS[number]["value"];

type LeadRow = {
  id: string;
  organization_id?: string | null;
  service_id?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  name?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  channel_user_id?: string | null;
  extracted_data?: Record<string, unknown> | null;
  resumen_auto?: string | null;
  recomendacion?: string | null;
  partner_recomendado?: string | null;
};

type ServiceConfigRow = {
  id: string;
  nombre?: string | null;
  menu_label?: string | null;
  icono?: string | null;
};

type PartnerRow = {
  id: string;
  nombre?: string | null;
  servicios?: string[] | null;
};

function normalizeStatus(status: unknown): ReferralStatus {
  const raw = String(status ?? "").trim();
  return STATUS_COLUMNS.some((column) => column.value === raw) ? raw as ReferralStatus : "new";
}

function leadName(lead: LeadRow): string {
  const extracted = lead.extracted_data ?? {};
  return String(lead.full_name ?? lead.name ?? lead.first_name ?? extracted.nombre ?? extracted.name ?? lead.channel_user_id ?? "Lead sin nombre").trim();
}

function serviceName(service?: ServiceConfigRow): string {
  return String(service?.menu_label ?? service?.nombre ?? "Servicio").trim();
}

function publicPartnerName(partner?: PartnerRow | null): string {
  return String(partner?.nombre ?? "")
    .replace(/^\s*\[EJEMPLO\]\s*/i, "")
    .trim();
}

function timeAgo(value?: string | null): string {
  if (!value) return "sin fecha";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "sin fecha";
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

function prettyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "No informado";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function priorityLabel(lead: LeadRow): string {
  const data = lead.extracted_data ?? {};
  return String(data.prioridad ?? data.priority ?? "").trim();
}

function redemptionCode(lead: LeadRow): string {
  const data = lead.extracted_data ?? {};
  return String(data.codigo_canje ?? data.redemption_code ?? "").trim();
}

function leadPhone(lead: LeadRow): string {
  const data = lead.extracted_data ?? {};
  const raw = String(data.telefono ?? lead.channel_user_id ?? "").trim();
  return raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
}

function LeadCard({
  lead,
  service,
  onOpen,
  onStatus,
}: {
  lead: LeadRow;
  service?: ServiceConfigRow;
  onOpen: () => void;
  onStatus: (status: ReferralStatus) => void;
}) {
  const [startX, setStartX] = useState<number | null>(null);
  const priority = priorityLabel(lead);

  function finishSwipe(clientX: number) {
    if (startX === null) return;
    const delta = clientX - startX;
    setStartX(null);
    if (delta > 72) onStatus("contacted");
    if (delta < -72) onOpen();
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      onTouchStart={(e) => setStartX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => finishSwipe(e.changedTouches[0]?.clientX ?? startX ?? 0)}
      className="group w-full rounded-2xl border border-white/[0.08] bg-[#111F2B]/82 p-3 text-left shadow-[0_10px_24px_rgba(0,0,0,0.18)] transition hover:border-[#25D366]/35 hover:bg-[#162838] active:scale-[0.99]"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#25D366]/20 bg-[#25D366]/10 text-lg">
          {service?.icono ?? "🤝"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-[#F8FAFC]">{leadName(lead)}</div>
          <div className="mt-0.5 truncate text-xs text-[#9CAAB8]">{serviceName(service)}</div>
          <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-[#6F7D8D]">
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">{timeAgo(lead.created_at)}</span>
          </div>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#526170] transition group-hover:text-[#25D366]" />
      </div>
      {priority ? (
        <div className="mt-3 inline-flex rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-amber-200">
          {priority}
        </div>
      ) : null}
    </button>
  );
}

export default function ReferralHubDashboard() {
  const vertical = getDetectedVerticalConfig();
  const { user } = useAuth();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [services, setServices] = useState<Record<string, ServiceConfigRow>>({});
  const [partners, setPartners] = useState<Record<string, PartnerRow>>({});
  const [selectedLead, setSelectedLead] = useState<LeadRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    setError(null);

    const [leadRes, serviceRes, partnerRes] = await Promise.all([
      supabase
        .from("leads")
        .select("*")
        .eq("organization_id", REFERRAL_ORG_ID)
        .not("service_id", "is", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("service_configs")
        .select("id, nombre, menu_label, icono")
        .eq("organization_id", REFERRAL_ORG_ID),
      supabase
        .from("partners")
        .select("id, nombre, servicios")
        .eq("organization_id", REFERRAL_ORG_ID),
    ]);

    if (leadRes.error) {
      setError("No se pudieron cargar los leads del Referral Hub.");
      setLoading(false);
      return;
    }

    const serviceMap = new Map<string, ServiceConfigRow>();
    if (!serviceRes.error && Array.isArray(serviceRes.data)) {
      for (const row of serviceRes.data as ServiceConfigRow[]) serviceMap.set(row.id, row);
    }

    const partnerMap = new Map<string, PartnerRow>();
    if (!partnerRes.error && Array.isArray(partnerRes.data)) {
      for (const row of partnerRes.data as PartnerRow[]) partnerMap.set(row.id, row);
    }

    setLeads((leadRes.data ?? []) as LeadRow[]);
    setServices(Object.fromEntries(serviceMap));
    setPartners(Object.fromEntries(partnerMap));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function updateLeadStatus(lead: LeadRow, status: ReferralStatus) {
    setActionLoading(`status:${status}`);
    setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, status } : item));
    setSelectedLead((current) => current?.id === lead.id ? { ...current, status } : current);
    const { error } = await supabase.from("leads").update({ status }).eq("id", lead.id);
    if (error) {
      setError("No se pudo actualizar el estado.");
      await load();
    } else {
      setNotice(`Guardado: ${STATUS_COLUMNS.find((item) => item.value === status)?.label ?? status}`);
    }
    setActionLoading(null);
  }

  function openPhoneLink(lead: LeadRow, kind: "call" | "whatsapp") {
    const phone = leadPhone(lead);
    if (!phone) {
      setError("Este lead no tiene teléfono disponible.");
      return;
    }
    const href = kind === "call" ? `tel:${phone}` : `https://wa.me/${phone}`;
    window.open(href, "_blank", "noopener,noreferrer");
    setNotice(kind === "call" ? "Abriendo llamada..." : "Abriendo WhatsApp...");
  }

  async function assignPartner(lead: LeadRow, partnerId: string) {
    const partner = partners[partnerId];
    if (!partner) return;
    setActionLoading("assign_partner");
    setError(null);

    const assignmentPayload = {
      lead_id: lead.id,
      partner_id: partnerId,
      organization_id: REFERRAL_ORG_ID,
      asignado_por: user?.id ?? null,
      resumen_enviado: lead.resumen_auto ?? null,
      estado: "assigned",
    };
    let assignment = await supabase.from("lead_assignments").insert(assignmentPayload).select("id").maybeSingle();

    if (assignment.error && String(assignment.error.message ?? "").includes("organization_id")) {
      const { organization_id: _organizationId, ...legacyPayload } = assignmentPayload;
      assignment = await supabase.from("lead_assignments").insert(legacyPayload).select("id").maybeSingle();
    }

    if (assignment.error) {
      setError("No se pudo crear la asignación del aliado.");
      setActionLoading(null);
      return;
    }

    const nextLead = {
      ...lead,
      status: "sent_to_partner",
      partner_recomendado: partnerId,
    };
    const leadUpdate = await supabase
      .from("leads")
      .update({
        status: "sent_to_partner",
        partner_recomendado: partnerId,
      })
      .eq("id", lead.id)
      .select("*")
      .maybeSingle();

    if (leadUpdate.error) {
      setError("La asignación se creó, pero no se pudo actualizar el lead.");
      setActionLoading(null);
      return;
    }

    const updated = (leadUpdate.data as LeadRow | null) ?? nextLead;
    setLeads((current) => current.map((item) => item.id === lead.id ? updated : item));
    setSelectedLead(updated);
    setAssigning(false);
    setNotice(`Aliado asignado: ${publicPartnerName(partner)}`);
    setActionLoading(null);
  }

  const filteredLeads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return leads;
    return leads.filter((lead) => {
      const service = lead.service_id ? services[lead.service_id] : undefined;
      return [
        leadName(lead),
        serviceName(service),
        lead.recomendacion,
        redemptionCode(lead),
      ].some((value) => String(value ?? "").toLowerCase().includes(normalized));
    });
  }, [leads, query, services]);

  const counts = useMemo(() => {
    return STATUS_COLUMNS.reduce<Record<ReferralStatus, number>>((acc, column) => {
      acc[column.value] = filteredLeads.filter((lead) => normalizeStatus(lead.status) === column.value).length;
      return acc;
    }, {
      new: 0,
      contacted: 0,
      qualified: 0,
      sent_to_partner: 0,
      closed: 0,
      not_qualified: 0,
    });
  }, [filteredLeads]);

  const selectedService = selectedLead?.service_id ? services[selectedLead.service_id] : undefined;
  const selectedPartner = selectedLead?.partner_recomendado ? partners[selectedLead.partner_recomendado] : null;
  const selectedPhone = selectedLead ? leadPhone(selectedLead) : "";
  const partnerOptions = selectedLead?.service_id
    ? Object.values(partners).filter((partner) => Array.isArray(partner.servicios) && partner.servicios.includes(selectedLead.service_id ?? ""))
    : [];

  return (
    <div className="space-y-4">
      <MobileCard elevated className="lg:hidden">
        <MobileHeader
          title="Referral Hub"
          eyebrow="Luis Gabriel"
          subtitle={`${filteredLeads.length} solicitudes activas`}
          action={<MobileStatusPill style={{ color: vertical.theme.accent, borderColor: `${vertical.theme.accent}55`, backgroundColor: vertical.theme.accentSoft }}>Activo</MobileStatusPill>}
        />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-[#25384A] bg-[#162838] px-3 py-2">
            <div className="text-lg font-black text-[#F8FAFC]">{counts.new}</div>
            <div className="text-[11px] text-[#9CAAB8]">nuevos</div>
          </div>
          <div className="rounded-2xl border border-[#25D366]/35 bg-[#25D366]/10 px-3 py-2">
            <div className="text-lg font-black text-[#F8FAFC]">{counts.qualified}</div>
            <div className="text-[11px] text-[#9CAAB8]">calificados</div>
          </div>
          <div className="rounded-2xl border border-[#25384A] bg-[#162838] px-3 py-2">
            <div className="text-lg font-black text-[#F8FAFC]">{counts.sent_to_partner}</div>
            <div className="text-[11px] text-[#9CAAB8]">enviados</div>
          </div>
        </div>
      </MobileCard>

      <section className="hidden rounded-[2rem] border border-white/10 bg-[#0B1620]/88 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.24)] lg:block">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/30 bg-[#25D366]/10 px-3 py-1 text-xs font-bold text-[#BDF8D1]">
              <Handshake className="h-3.5 w-3.5" />
              Creatyv Referral Hub
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-white">Solicitudes de Luis Gabriel</h1>
            <p className="mt-1 text-sm text-white/58">Organiza leads, aliados y códigos de canje desde un tablero simple.</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-bold text-white/78 transition hover:border-[#25D366]/35 hover:text-[#25D366]"
          >
            <RefreshCcw className="h-4 w-4" />
            Actualizar
          </button>
        </div>
      </section>

      <div className="flex items-center gap-2 rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 py-2 lg:border-white/10 lg:bg-white/[0.045]">
        <Search className="h-4 w-4 text-[#9CAAB8]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar nombre, servicio o código..."
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-[#F8FAFC] outline-none placeholder:text-[#6F7D8D]"
        />
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-2xl border border-[#25D366]/30 bg-[#25D366]/10 px-4 py-3 text-sm font-bold text-[#BDF8D1]">
          <CheckCircle2 className="mr-2 inline h-4 w-4" />
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-[260px] items-center justify-center rounded-3xl border border-[#25384A] bg-[#111F2B] text-[#9CAAB8]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Cargando solicitudes...
        </div>
      ) : filteredLeads.length === 0 ? (
        <MobileEmptyState icon={Handshake} title="Todavía no hay solicitudes." description="Cuando entren leads desde WhatsApp van a aparecer acá." />
      ) : (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 lg:mx-0 lg:grid lg:grid-cols-6 lg:overflow-visible lg:px-0">
          {STATUS_COLUMNS.map((column) => {
            const columnLeads = filteredLeads.filter((lead) => normalizeStatus(lead.status) === column.value);
            return (
              <section key={column.value} className="min-w-[280px] rounded-3xl border border-[#25384A] bg-[#0B1620]/88 p-3 lg:min-w-0 lg:border-white/10 lg:bg-white/[0.035]">
                <div className="mb-3 flex items-center justify-between gap-2 px-1">
                  <h2 className="truncate text-sm font-black text-[#F8FAFC]">{column.label}</h2>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-black text-[#9CAAB8]">
                    {columnLeads.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {columnLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      service={lead.service_id ? services[lead.service_id] : undefined}
                      onOpen={() => setSelectedLead(lead)}
                      onStatus={(status) => void updateLeadStatus(lead, status)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <MobileBottomSheet open={Boolean(selectedLead)} className="max-h-[86vh] overflow-y-auto">
        {selectedLead ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9CAAB8]">{serviceName(selectedService)}</div>
                <h2 className="mt-1 truncate text-xl font-black text-[#F8FAFC]">{leadName(selectedLead)}</h2>
                <p className="mt-1 text-xs text-[#9CAAB8]">{timeAgo(selectedLead.created_at)} · {STATUS_COLUMNS.find((item) => item.value === normalizeStatus(selectedLead.status))?.label}</p>
              </div>
              <button type="button" onClick={() => setSelectedLead(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111F2B] text-[#9CAAB8]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-2xl border border-[#25384A] bg-[#111F2B] p-3">
              <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-[#9CAAB8]">Resumen</div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-[#F8FAFC]">{selectedLead.resumen_auto || "Sin resumen todavía."}</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#25384A] bg-[#111F2B] p-3">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-[#9CAAB8]">Recomendación</div>
                <p className="mt-2 text-sm text-[#F8FAFC]">{selectedLead.recomendacion || "Sin recomendación."}</p>
              </div>
              <div className="rounded-2xl border border-[#25384A] bg-[#111F2B] p-3">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-[#9CAAB8]">Aliado</div>
                <p className="mt-2 text-sm text-[#F8FAFC]">{publicPartnerName(selectedPartner) || "Sin aliado asignado."}</p>
              </div>
            </div>

            {redemptionCode(selectedLead) ? (
              <div className="rounded-2xl border border-[#25D366]/30 bg-[#25D366]/10 p-3">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-[#BDF8D1]">Código de canje</div>
                <p className="mt-2 font-mono text-lg font-black text-[#F8FAFC]">{redemptionCode(selectedLead)}</p>
              </div>
            ) : null}

            <div className="rounded-2xl border border-[#25384A] bg-[#111F2B] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-[#9CAAB8]">Acciones</div>
                  <div className="mt-1 text-xs text-[#6F7D8D]">{selectedPhone ? `Teléfono: ${selectedPhone}` : "Sin teléfono disponible"}</div>
                </div>
                {notice ? <CheckCircle2 className="h-4 w-4 text-[#25D366]" /> : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MobileActionButton tone="accent" disabled={!selectedPhone} onClick={() => openPhoneLink(selectedLead, "call")}>
                  <Phone className="h-3.5 w-3.5" />
                  Llamar
                </MobileActionButton>
                <MobileActionButton tone="accent" disabled={!selectedPhone} onClick={() => openPhoneLink(selectedLead, "whatsapp")}>
                  <MessageCircle className="h-3.5 w-3.5" />
                  Abrir WhatsApp
                </MobileActionButton>
                <MobileActionButton tone="default" onClick={() => setAssigning((value) => !value)}>
                  <Send className="h-3.5 w-3.5" />
                  Asignar aliado
                </MobileActionButton>
                <MobileActionButton tone="default" disabled={actionLoading === "status:contacted"} onClick={() => void updateLeadStatus(selectedLead, "contacted")}>
                  {actionLoading === "status:contacted" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                  Marcar contactado
                </MobileActionButton>
                <MobileActionButton tone="danger" disabled={actionLoading === "status:not_qualified"} onClick={() => void updateLeadStatus(selectedLead, "not_qualified")}>
                  {actionLoading === "status:not_qualified" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  No califica
                </MobileActionButton>
                <MobileActionButton tone="success" disabled={actionLoading === "status:closed"} onClick={() => void updateLeadStatus(selectedLead, "closed")}>
                  {actionLoading === "status:closed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Cerrar lead
                </MobileActionButton>
              </div>
              {assigning ? (
                <div className="mt-3 rounded-2xl border border-[#25384A] bg-[#0B1620] p-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[#9CAAB8]">Elegir aliado</div>
                  {partnerOptions.length === 0 ? (
                    <p className="text-sm text-[#9CAAB8]">No hay aliados conectados a este servicio.</p>
                  ) : (
                    <div className="space-y-2">
                      {partnerOptions.map((partner) => (
                        <button
                          key={partner.id}
                          type="button"
                          disabled={actionLoading === "assign_partner"}
                          onClick={() => void assignPartner(selectedLead, partner.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#25384A] bg-[#111F2B] px-3 py-2 text-left text-sm font-bold text-[#F8FAFC] transition hover:border-[#25D366]/35 disabled:opacity-60"
                        >
                          <span className="truncate">{publicPartnerName(partner)}</span>
                          {actionLoading === "assign_partner" ? <Loader2 className="h-4 w-4 animate-spin text-[#25D366]" /> : <ChevronRight className="h-4 w-4 text-[#6F7D8D]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-[#25384A] bg-[#111F2B] p-3">
              <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-[#9CAAB8]">Datos capturados</div>
              <div className="space-y-2">
                {Object.entries(selectedLead.extracted_data ?? {}).length === 0 ? (
                  <p className="text-sm text-[#9CAAB8]">Sin datos capturados.</p>
                ) : (
                  Object.entries(selectedLead.extracted_data ?? {}).map(([key, value]) => (
                    <div key={key} className="rounded-xl border border-[#25384A] bg-[#0B1620] px-3 py-2">
                      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6F7D8D]">{key}</div>
                      <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm text-[#F8FAFC]">{prettyValue(value)}</pre>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STATUS_COLUMNS.map((status) => (
                <MobileActionButton
                  key={status.value}
                  tone={normalizeStatus(selectedLead.status) === status.value ? "accent" : "default"}
                  onClick={() => void updateLeadStatus(selectedLead, status.value)}
                  className="min-h-11"
                >
                  {normalizeStatus(selectedLead.status) === status.value ? <CheckCircle2 className="h-3.5 w-3.5" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
                  {status.label}
                </MobileActionButton>
              ))}
            </div>
          </div>
        ) : null}
      </MobileBottomSheet>
    </div>
  );
}
