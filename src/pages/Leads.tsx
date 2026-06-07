import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MessageCircle, Phone, Mail, Calendar, CheckCircle2, Clock, Filter, Search, History, Scissors } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { getVerticalConfig } from "../config/verticalConfig";
import { MobileClientRow, MobileEmptyState, MobileFilterChips } from "../components/mobile/MobilePrimitives";
import { BarberLineButton, BarberLineCard, BarberLineDrawer, BarberLineInput, BarberLinePageShell, BarberLineStatus } from "../components/barberline/BarberLineUI";

const DEFAULT_ORG = "clinic-demo";

type LeadRow = {
  id: string;
  organization_id: string;
  channel_user_id: string | null;
  avatar_url: string | null;
  state: Record<string, any> | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  channel: string | null;
  last_channel: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  handoff_to_human: boolean | null;
  created_at: string | null;
};

// Helper: Get best display name
function getBestDisplayName(lead: LeadRow): string {
  if (lead.full_name && lead.full_name.trim() && !lead.full_name.startsWith("Usuario ")) {
    return lead.full_name.trim();
  }
  if (lead.first_name) {
    const parts = [lead.first_name, lead.last_name].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  const stateName = lead.state?.name;
  if (stateName && typeof stateName === "string" && stateName.trim() && !stateName.startsWith("Usuario ")) {
    return stateName.trim();
  }
  // Fallback
  if (lead.phone) return lead.phone;
  if (lead.email) return lead.email;
  return "Sin nombre";
}

// Helper: Format relative time
function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "ahora";
  if (diffMins < 60) return `hace ${diffMins}m`;
  if (diffHours < 24) return `hace ${diffHours}h`;
  if (diffDays < 7) return `hace ${diffDays}d`;
  return date.toLocaleDateString("es", { day: "numeric", month: "short" });
}

function effectiveLeadChannel(lead: Pick<LeadRow, "channel" | "last_channel">): string {
  return String(lead.channel ?? lead.last_channel ?? "whatsapp").trim().toLowerCase() || "whatsapp";
}

function cleanBarberPreview(value: string | null | undefined): string {
  const text = String(value ?? "")
    .replace(/\*/g, "")
    .replace(/Servicio:\s*[^.\n]+/gi, "")
    .replace(/Fecha:\s*[^.\n]+/gi, "")
    .replace(/Hora:\s*[^.\n]+/gi, "")
    .replace(/Barbero:\s*[^.\n]+/gi, "")
    .replace(/Nombre:\s*[^.\n]+/gi, "")
    .replace(/Cl[ií]nica\s+Sonrisas/gi, "BarberLine")
    .replace(/\bcl[ií]nica\b/gi, "barbería")
    .replace(/\bpacientes?\b/gi, "clientes")
    .replace(/\bdoctores?\b/gi, "barberos")
    .replace(/\bdental(?:es)?\b/gi, "")
    .replace(/\btratamientos?\b/gi, "servicios")
    .replace(/appointment[_\s-]?id[:=]\s*\S+/gi, "")
    .replace(/active_appointment|pending_reschedule|current_flow|collected/gi, "")
    .replace(/\{[^{}]{20,}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Sin mensajes todavía";
  return text.length > 80 ? `${text.slice(0, 77).trim()}...` : text;
}

function leadFrequentService(lead: LeadRow): string {
  const state = lead.state ?? {};
  return String(
    state.frequent_service ??
    state.last_service ??
    state.service ??
    state.selected_service ??
    state.reason ??
    "No definido",
  );
}

function leadLastAppointment(lead: LeadRow): string {
  const value = lead.state?.last_appointment_date ?? lead.state?.appointment_date ?? lead.state?.selected_date;
  if (!value) return "Sin registro";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric" });
}

function leadVisitCount(lead: LeadRow): string {
  const value = lead.state?.visit_count ?? lead.state?.visits ?? lead.state?.appointment_count;
  return value == null ? "Sin registro" : String(value);
}

function DrawerField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#4A5260]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[#DDE4EC]">{value}</p>
    </div>
  );
}

// Status badge component
function StatusBadge({ status }: { status: string | null }) {
  const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
    new: { label: "Nuevo", bg: "bg-blue-500/10", text: "text-blue-400" },
    contacted: { label: "Contactado", bg: "bg-amber-500/10", text: "text-amber-400" },
    qualified: { label: "Calificado", bg: "bg-purple-500/10", text: "text-purple-400" },
    attended: { label: "Atendido", bg: "bg-emerald-500/10", text: "text-emerald-400" },
    lost: { label: "Perdido", bg: "bg-white/5", text: "text-white/50" },
  };
  const config = statusConfig[status || "new"] || statusConfig.new;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

export default function Leads() {
  const navigate = useNavigate();
  const { resolvedOrgId, resolvedBusinessType } = useActiveOrg();
  const vertical = getVerticalConfig(resolvedBusinessType);
  const isBarbershop = resolvedBusinessType === "barbershop";
  const ORG = resolvedOrgId || DEFAULT_ORG;

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedCustomer, setSelectedCustomer] = useState<LeadRow | null>(null);
  const [profileSection, setProfileSection] = useState<"perfil" | "historial">("perfil");
  const [appointmentLead, setAppointmentLead] = useState<LeadRow | null>(null);
  const [visualNotice, setVisualNotice] = useState("");

  function showVisualNotice(message: string) {
    setVisualNotice(message);
    window.setTimeout(() => setVisualNotice(""), 2600);
  }

  function openCustomerProfile(lead: LeadRow, section: "perfil" | "historial" = "perfil") {
    setSelectedCustomer(lead);
    setProfileSection(section);
  }

  async function loadLeads() {
    setLoading(true);
    const { data, error } = await supabase
      .from("leads")
      .select("id, organization_id, full_name, first_name, last_name, avatar_url, phone, email, status, channel, last_channel, channel_user_id, state, last_message_at, last_message_preview, handoff_to_human, created_at")
      .eq("organization_id", ORG)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500);

    if (!error && data) {
      setLeads(data as LeadRow[]);
      if (import.meta.env.DEV) {
        console.log("[leads:debug_load]", {
          org: ORG,
          searchTerm: searchQuery,
          leadQueryResultIds: (data as LeadRow[]).map((lead) => lead.id),
        });
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    if (ORG) loadLeads();
  }, [ORG]);

  // Filter leads
  const filteredLeads = leads.filter((l) => {
    // Status filter
    if (filterStatus !== "all" && l.status !== filterStatus) return false;
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const name = getBestDisplayName(l).toLowerCase();
      const phone = (l.phone || "").toLowerCase();
      const email = (l.email || "").toLowerCase();
      const firstName = (l.first_name || "").toLowerCase();
      const channelUserId = (l.channel_user_id || "").toLowerCase();
      const preview = (l.last_message_preview || "").toLowerCase();
      if (
        !name.includes(q) &&
        !firstName.includes(q) &&
        !phone.includes(q) &&
        !email.includes(q) &&
        !channelUserId.includes(q) &&
        !preview.includes(q)
      ) return false;
    }
    return true;
  });

  // Stats
  const stats = {
    total: leads.length,
    new: leads.filter((l) => l.status === "new" || !l.status).length,
    contacted: leads.filter((l) => l.status === "contacted").length,
    attended: leads.filter((l) => l.status === "attended").length,
  };

  if (isBarbershop) {
    return (
      <BarberLinePageShell title="Clientes" subtitle="Historial y contactos de tu barbería." eyebrow="CLIENTES · BARBERLINE">
        <div className="grid grid-cols-3 gap-3">
          <BarberLineCard className="p-4 text-center">
            <p className="text-2xl font-black text-[#F5F7FA]">{stats.total}</p>
            <p className="mt-1 text-xs text-[#A4AAB3]">Total clientes</p>
          </BarberLineCard>
          <BarberLineCard className="p-4 text-center">
            <p className="text-2xl font-black text-[#18C37E]">{stats.attended}</p>
            <p className="mt-1 text-xs text-[#A4AAB3]">Atendidos</p>
          </BarberLineCard>
          <BarberLineCard className="p-4 text-center">
            <p className="text-2xl font-black text-[#F5F7FA]">{stats.new}</p>
            <p className="mt-1 text-xs text-[#A4AAB3]">Nuevos</p>
          </BarberLineCard>
        </div>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6F7680]" />
          <BarberLineInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar cliente o teléfono..."
            className="pl-10"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { value: "all", label: `Todos (${stats.total})` },
            { value: "new", label: `Nuevos (${stats.new})` },
            { value: "contacted", label: `Contactados (${stats.contacted})` },
            { value: "attended", label: `Atendidos (${stats.attended})` },
          ].map((item) => (
            <button
              key={item.value}
              onClick={() => setFilterStatus(item.value)}
              className={filterStatus === item.value
                ? "rounded-full border border-[#18C37E]/25 bg-[#18C37E]/10 px-3 py-1.5 text-xs font-bold text-[#18C37E]"
                : "rounded-full border border-[#252A30] bg-[#121417] px-3 py-1.5 text-xs font-bold text-[#A4AAB3] hover:text-[#F5F7FA]"}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading ? (
          <BarberLineCard className="p-10 text-center text-sm text-[#A4AAB3]">Cargando clientes...</BarberLineCard>
        ) : filteredLeads.length === 0 ? (
          <BarberLineCard className="p-10 text-center">
            <MessageCircle className="mx-auto mb-3 h-9 w-9 text-[#4A5260]" />
            <p className="text-sm font-bold text-[#F5F7FA]">{searchQuery ? "Sin resultados" : "Todavía no hay clientes."}</p>
            <p className="mt-1 text-xs text-[#6F7680]">{searchQuery ? "Probá con otra búsqueda." : "Los clientes aparecerán cuando entren conversaciones por WhatsApp."}</p>
          </BarberLineCard>
        ) : (
          <div className="space-y-3">
            {filteredLeads.map((lead) => {
              const displayName = getBestDisplayName(lead);
              const channelLabel = effectiveLeadChannel(lead).toUpperCase();
              const handoff = lead.handoff_to_human === true || String(lead.state?.conversation_mode ?? "").toLowerCase() === "human_active";
              return (
                <BarberLineCard key={lead.id} className="p-4" onClick={() => openCustomerProfile(lead)}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#252A30] bg-[#171A1E] text-sm font-bold text-[#A4AAB3]">
                      {displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-[#F5F7FA]">{displayName}</p>
                        <BarberLineStatus label={lead.status || "Nuevo"} tone={lead.status === "attended" ? "success" : "neutral"} />
                        <BarberLineStatus label={handoff ? "Humano" : "Bot"} tone={handoff ? "warning" : "success"} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[#A4AAB3]">
                        {lead.phone ? <span className="flex items-center gap-1"><Phone className="h-3 w-3 text-[#6F7680]" />{lead.phone}</span> : null}
                        {lead.email ? <span className="flex items-center gap-1"><Mail className="h-3 w-3 text-[#6F7680]" />{lead.email}</span> : null}
                        <span>{leadFrequentService(lead)}</span>
                        <span>{leadLastAppointment(lead)}</span>
                        <span>{channelLabel}</span>
                        <span>{formatRelativeTime(lead.last_message_at || lead.created_at)}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#A4AAB3]">
                        "{cleanBarberPreview(lead.last_message_preview)}"
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2 border-t border-[#1E2227] pt-3">
                    <BarberLineButton variant="ghost" className="min-h-8 px-2.5 py-1.5 text-xs" onClick={(event) => { event.stopPropagation(); openCustomerProfile(lead, "historial"); }}><History className="h-3.5 w-3.5" />Historial</BarberLineButton>
                    <BarberLineButton variant="ghost" className="min-h-8 px-2.5 py-1.5 text-xs text-[#25D366]" onClick={(event) => { event.stopPropagation(); navigate(`/inbox/${lead.id}`); }}><MessageCircle className="h-3.5 w-3.5" />Mensaje</BarberLineButton>
                    <BarberLineButton variant="ghost" className="min-h-8 px-2.5 py-1.5 text-xs text-[#18C37E]" onClick={(event) => { event.stopPropagation(); setAppointmentLead(lead); }}><Calendar className="h-3.5 w-3.5" />Agendar cita</BarberLineButton>
                    <span className="ml-auto hidden items-center gap-1 text-xs text-[#6F7680] md:flex"><Scissors className="h-3 w-3" />Cliente</span>
                  </div>
                </BarberLineCard>
              );
            })}
          </div>
        )}
        {visualNotice ? (
          <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-[#18C37E]/20 bg-[#0B0D0F] px-4 py-3 text-sm font-semibold text-[#BDF8D1] shadow-2xl">
            {visualNotice}
          </div>
        ) : null}
        <BarberLineDrawer
          open={Boolean(selectedCustomer)}
          title="Perfil del cliente"
          subtitle={selectedCustomer ? getBestDisplayName(selectedCustomer) : undefined}
          onClose={() => setSelectedCustomer(null)}
        >
          {selectedCustomer ? (
            <div className="space-y-4">
              <BarberLineCard className="grid gap-4 p-4 sm:grid-cols-2">
                <DrawerField label="Nombre" value={getBestDisplayName(selectedCustomer)} />
                <DrawerField label="Teléfono" value={selectedCustomer.phone || "Sin teléfono"} />
                <DrawerField label="Servicio frecuente" value={leadFrequentService(selectedCustomer)} />
                <DrawerField label="Última cita" value={leadLastAppointment(selectedCustomer)} />
                <DrawerField label="Total visitas" value={leadVisitCount(selectedCustomer)} />
                <DrawerField label="Próxima cita" value={String(selectedCustomer.state?.next_appointment_date ?? "Sin próxima cita")} />
              </BarberLineCard>
              <BarberLineCard className="p-4">
                <div className="mb-2 text-sm font-black text-[#F5F7FA]">Notas</div>
                <p className="text-sm leading-relaxed text-[#A4AAB3]">{String(selectedCustomer.state?.notes ?? "Sin notas guardadas.")}</p>
              </BarberLineCard>
              <BarberLineCard className="p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-sm font-black text-[#F5F7FA]">{profileSection === "historial" ? "Historial de citas" : "Últimos mensajes"}</div>
                  <button type="button" onClick={() => setProfileSection(profileSection === "historial" ? "perfil" : "historial")} className="text-xs font-bold text-[#18C37E]">
                    {profileSection === "historial" ? "Ver mensajes" : "Ver historial"}
                  </button>
                </div>
                {profileSection === "historial" ? (
                  <div className="space-y-2 text-sm text-[#A4AAB3]">
                    <div className="rounded-xl border border-[#252A30] bg-[#0A0C0F] p-3">
                      {leadLastAppointment(selectedCustomer)} · {leadFrequentService(selectedCustomer)}
                    </div>
                    <div className="text-xs text-[#5A6270]">El historial detallado se conecta desde las citas reales del cliente.</div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#252A30] bg-[#0A0C0F] p-3 text-sm text-[#A4AAB3]">
                    {cleanBarberPreview(selectedCustomer.last_message_preview)}
                  </div>
                )}
              </BarberLineCard>
              <div className="grid gap-2 sm:grid-cols-3">
                <BarberLineButton onClick={() => navigate(`/inbox/${selectedCustomer.id}`)}>Enviar mensaje</BarberLineButton>
                <BarberLineButton variant="secondary" onClick={() => setAppointmentLead(selectedCustomer)}>Agendar cita</BarberLineButton>
                <BarberLineButton variant="secondary" onClick={() => showVisualNotice("Editor de cliente listo para conectar")}>Editar cliente</BarberLineButton>
              </div>
            </div>
          ) : null}
        </BarberLineDrawer>
        <BarberLineDrawer
          open={Boolean(appointmentLead)}
          title="Agendar cita"
          subtitle={appointmentLead ? getBestDisplayName(appointmentLead) : undefined}
          onClose={() => setAppointmentLead(null)}
        >
          {appointmentLead ? (
            <div className="space-y-4">
              <BarberLineCard className="p-4">
                <DrawerField label="Cliente" value={getBestDisplayName(appointmentLead)} />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <DrawerField label="Teléfono" value={appointmentLead.phone || "Sin teléfono"} />
                  <DrawerField label="Servicio sugerido" value={leadFrequentService(appointmentLead)} />
                </div>
              </BarberLineCard>
              <p className="text-sm leading-relaxed text-[#A4AAB3]">Este panel es visual por ahora. Para crear una cita real, abrí Citas con el cliente en contexto.</p>
              <BarberLineButton className="w-full" onClick={() => navigate(`/agenda?lead=${encodeURIComponent(appointmentLead.id)}`)}>Abrir agenda</BarberLineButton>
            </div>
          ) : null}
        </BarberLineDrawer>
      </BarberLinePageShell>
    );
  }

  return (
    <div className={`flex min-h-screen flex-col ${isBarbershop ? "bg-[#050608] text-[#F0F4F8]" : "bg-[#0B1620] lg:bg-[#0B1117]"}`}>
      {/* Header */}
      <div className={`safe-area-top sticky top-0 z-20 border-b backdrop-blur-lg ${isBarbershop ? "border-[#1E2227] bg-[#0B0D0F]/95" : "border-[#25384A] bg-[#0B1620]/95 lg:border-white/10 lg:bg-[#0B1117]/90"}`}>
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate("/overview")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#162838] transition hover:bg-[#192B42] lg:hidden"
          >
            <ArrowLeft className="h-5 w-5 text-[#F8FAFC]" />
          </button>
          <div className="flex-1">
            {isBarbershop ? <div className="bl-eyebrow">CLIENTES · BARBERLINE</div> : null}
            <h1 className="text-[22px] font-black tracking-[-0.03em] text-[#F8FAFC]">{vertical.customersLabel}</h1>
            <p className="text-xs text-[#9CAAB8]">{stats.total} {resolvedBusinessType === "barbershop" ? "clientes" : "contactos"}</p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="px-4 pb-3">
          <MobileFilterChips
            value={filterStatus}
            onChange={setFilterStatus}
            items={[
              { value: "all", label: `Todos (${stats.total})` },
              { value: "new", label: `Nuevos (${stats.new})` },
              { value: "contacted", label: `Contactados (${stats.contacted})` },
              { value: "attended", label: `Atendidos (${stats.attended})` },
            ]}
          />
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={resolvedBusinessType === "barbershop" ? "Buscar cliente o teléfono..." : "Buscar por nombre, teléfono o email..."}
              className={`h-11 w-full rounded-2xl border pl-10 pr-4 text-sm text-[#F8FAFC] outline-none transition placeholder:text-[#9CAAB8]/70 focus:border-[#25D366]/60 focus:ring-4 focus:ring-[#25D366]/15 ${isBarbershop ? "border-white/[0.08] bg-[#05060A]" : "border-[#25384A] bg-[#111F2B]"}`}
            />
          </div>
        </div>
      </div>

      {/* Leads list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-sm text-white/50">Cargando {vertical.customersLabel.toLowerCase()}...</div>
          </div>
        ) : filteredLeads.length === 0 ? (
          <MobileEmptyState
            icon={MessageCircle}
            title={searchQuery ? "Sin resultados" : `Sin ${vertical.customersLabel.toLowerCase()}`}
            description={searchQuery ? "Intenta con otra búsqueda" : `${vertical.customersLabel} aparecerán aquí`}
          />
        ) : (
          <div className="space-y-3">
            {filteredLeads.map((lead) => {
              const displayName = getBestDisplayName(lead);
              const avatarFallback = displayName.slice(0, 1).toUpperCase();
              const channelLabel = effectiveLeadChannel(lead).toUpperCase();
              const handoff = lead.handoff_to_human === true || String(lead.state?.conversation_mode ?? "").toLowerCase() === "human_active";

              return (
                <MobileClientRow
                  key={lead.id}
                  onClick={() => navigate(`/inbox/${lead.id}`)}
                  className={isBarbershop ? "border-[#1E2228] bg-[#0E1014] hover:bg-[#131820]" : ""}
                >
                  <div className="flex gap-3">
                    {/* Avatar */}
                    <div className="shrink-0">
                      {lead.avatar_url ? (
                        <img
                          src={lead.avatar_url}
                          alt={displayName}
                          className="h-10 w-10 rounded-full border border-[#25384A] object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#162838] text-xs font-black text-[#25D366]">
                          {avatarFallback}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Name + time row */}
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="truncate font-bold text-[#F8FAFC]">{displayName}</span>
                        <span className="shrink-0 text-[11px] text-[#9CAAB8]">
                          {formatRelativeTime(lead.last_message_at || lead.created_at)}
                        </span>
                      </div>

                      {/* Contact info */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#9CAAB8] mb-2">
                        {lead.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {lead.phone}
                          </span>
                        )}
                        {lead.email && (
                          <span className="flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3" />
                            {lead.email}
                          </span>
                        )}
                      </div>

                      {/* Preview message - NOW VISIBLE IN VERTICAL MODE */}
                      <div
                        className="text-xs text-[#9CAAB8] leading-relaxed mb-2"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {lead.last_message_preview ? `"${lead.last_message_preview}"` : "Sin mensajes todavía"}
                      </div>

                      {/* Tags row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={lead.status} />
                        <span className="inline-flex rounded-full border border-[#25384A] bg-[#162838] px-2 py-0.5 text-[10px] font-medium text-[#9CAAB8]">
                          {channelLabel}
                        </span>
                        <span className={[
                          "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          handoff
                            ? "border-amber-400/25 bg-amber-500/10 text-amber-300"
                            : "border-emerald-400/25 bg-emerald-500/10 text-emerald-300",
                        ].join(" ")}>
                          {handoff ? "Humano" : "Bot"}
                        </span>
                        {false && (
                          <span className="inline-flex rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/35">
                            {lead.organization_id} / {lead.channel ?? "unknown"} / {lead.id.slice(-6)}
                          </span>
                        )}
                      </div>
                      {isBarbershop ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button onClick={(event) => { event.stopPropagation(); navigate(`/inbox/${lead.id}`); }} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-semibold text-[#8A9299] hover:text-[#F0F4F8]">
                            Historial
                          </button>
                          <button onClick={(event) => { event.stopPropagation(); navigate(`/inbox/${lead.id}`); }} className="rounded-lg border border-[#25D366]/[0.14] bg-[#25D366]/[0.07] px-2.5 py-1.5 text-[11px] font-semibold text-[#25D366]">
                            Mensaje
                          </button>
                          <button onClick={(event) => { event.stopPropagation(); navigate("/agenda"); }} className="rounded-lg border border-[#18C37E]/20 bg-[#18C37E]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#18C37E]">
                            Agendar cita
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </MobileClientRow>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom safe area */}
      <div className="h-20 lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
    </div>
  );
}
