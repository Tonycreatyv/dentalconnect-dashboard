import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MessageCircle, Phone, Mail, Calendar, CheckCircle2, Clock, Filter, Search } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";

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
  const { clinic } = useClinic();
  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  async function loadLeads() {
    setLoading(true);
    const { data, error } = await supabase
      .from("leads")
      .select("id, organization_id, full_name, first_name, last_name, avatar_url, phone, email, status, channel, last_channel, channel_user_id, state, last_message_at, last_message_preview, created_at")
      .eq("organization_id", ORG)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500);

    if (!error && data) {
      setLeads(data as LeadRow[]);
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
      if (!name.includes(q) && !phone.includes(q) && !email.includes(q)) return false;
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
    <div className="flex min-h-screen flex-col bg-[#0B1117]">
      {/* Header */}
      <div className="safe-area-top sticky top-0 z-20 border-b border-white/10 bg-[#0B1117]/90 backdrop-blur-lg">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate("/overview")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 transition hover:bg-white/10 lg:hidden"
          >
            <ArrowLeft className="h-5 w-5 text-white/80" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">Leads</h1>
            <p className="text-xs text-white/50">{stats.total} contactos</p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          <button
            onClick={() => setFilterStatus("all")}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${filterStatus === "all" ? "bg-white/15 text-white" : "bg-white/5 text-white/60"}`}
          >
            Todos ({stats.total})
          </button>
          <button
            onClick={() => setFilterStatus("new")}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${filterStatus === "new" ? "bg-blue-500/10 text-blue-300" : "bg-white/5 text-white/50 hover:bg-blue-500/10 hover:text-blue-300"}`}
          >
            Nuevos ({stats.new})
          </button>
          <button
            onClick={() => setFilterStatus("contacted")}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${filterStatus === "contacted" ? "bg-amber-500/10 text-amber-300" : "bg-white/5 text-white/50 hover:bg-amber-500/10 hover:text-amber-300"}`}
          >
            Contactados ({stats.contacted})
          </button>
          <button
            onClick={() => setFilterStatus("attended")}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${filterStatus === "attended" ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-white/50 hover:bg-emerald-500/10 hover:text-emerald-300"}`}
          >
            Atendidos ({stats.attended})
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre, teléfono o email..."
              className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#3CBDB9] focus:ring-4 focus:ring-[#3CBDB9]/20"
            />
          </div>
        </div>
      </div>

      {/* Leads list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-sm text-white/50">Cargando leads...</div>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageCircle className="mb-3 h-12 w-12 text-white/30" />
            <div className="text-sm font-medium text-white/80">
              {searchQuery ? "Sin resultados" : "Sin leads"}
            </div>
            <div className="mt-1 text-xs text-white/50">
              {searchQuery ? "Intenta con otra búsqueda" : "Los leads aparecerán aquí"}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredLeads.map((lead) => {
              const displayName = getBestDisplayName(lead);
              const avatarFallback = displayName.slice(0, 1).toUpperCase();
              const channelLabel = (lead.last_channel || lead.channel || "messenger").toUpperCase();

              return (
                <button
                  key={lead.id}
                  onClick={() => navigate(`/inbox/${lead.id}`)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:bg-white/10"
                >
                  <div className="flex gap-3">
                    {/* Avatar */}
                    <div className="shrink-0">
                      {lead.avatar_url ? (
                        <img
                          src={lead.avatar_url}
                          alt={displayName}
                          className="h-12 w-12 rounded-full border border-white/10 object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-sm font-bold text-white">
                          {avatarFallback}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Name + time row */}
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="truncate font-semibold text-white">{displayName}</span>
                        <span className="shrink-0 text-[11px] text-white/40">
                          {formatRelativeTime(lead.last_message_at || lead.created_at)}
                        </span>
                      </div>

                      {/* Contact info */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50 mb-2">
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
                      {lead.last_message_preview && (
                        <div
                          className="text-xs text-white/60 leading-relaxed mb-2"
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          "{lead.last_message_preview}"
                        </div>
                      )}

                      {/* Tags row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={lead.status} />
                        <span className="inline-flex rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/50">
                          {channelLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
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
