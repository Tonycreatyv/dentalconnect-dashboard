import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MessageCircle, Phone, Mail, Calendar, CheckCircle2, Clock, Filter, Search } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { getVerticalConfig } from "../config/verticalConfig";
import { MobileClientRow, MobileEmptyState, MobileFilterChips } from "../components/mobile/MobilePrimitives";

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
