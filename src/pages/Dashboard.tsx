// src/pages/Overview.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { SectionCard } from "../components/SectionCard";

const ORG = "clinic-demo";

type LeadRow = {
  id: string;
  full_name: string | null;
  channel: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_bot_reply_at: string | null;
  follow_up_due_at: string | null;
};

type MsgRow = {
  id: string;
  lead_id: string | null;
  actor: string | null;
  content: string | null;
  created_at: string;
};

function StatCard({
  title,
  value,
  hint,
  onClick,
}: {
  title: string;
  value: number;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-left hover:bg-white/[0.06] transition"
    >
      <div className="text-xs tracking-[0.25em] text-white/40 uppercase">{title}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm text-white/60">{hint}</div>
    </button>
  );
}

export default function Overview() {
  const navigate = useNavigate();

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [recent, setRecent] = useState<MsgRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);

    const { data: ldata } = await supabase
      .from("leads")
      .select("id, full_name, channel, last_message_at, last_message_preview, last_bot_reply_at, follow_up_due_at")
      .eq("organization_id", ORG)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);

    const { data: mdata } = await supabase
      .from("messages")
      .select("id, lead_id, actor, content, created_at")
      .eq("organization_id", ORG)
      .order("created_at", { ascending: false })
      .limit(8);

    setLeads((ldata as any) ?? []);
    setRecent((mdata as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const now = useMemo(() => new Date(), []);
  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const followupsToday = useMemo(() => {
    return leads.filter((l) => l.follow_up_due_at && new Date(l.follow_up_due_at) >= todayStart).length;
  }, [leads, todayStart]);

  const noBotReply = useMemo(() => {
    // Leads con mensaje reciente pero sin respuesta del bot “cerca” (simple heurística)
    return leads.filter((l) => l.last_message_at && !l.last_bot_reply_at).length;
  }, [leads]);

  const activeLeads = useMemo(() => {
    return leads.filter((l) => l.last_message_at).length;
  }, [leads]);

  const pendingConfirm = useMemo(() => {
    // placeholder realista: después lo conectamos a appointments.status='pending'
    return leads.filter((l) => l.last_message_preview?.toLowerCase().includes("mañana")).length;
  }, [leads]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-white">Overview</h2>
      <p className="text-sm text-white/60">
        Operación diaria: confirmaciones, follow-ups y actividad reciente.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <StatCard
          title="Leads activos"
          value={loading ? 0 : activeLeads}
          hint="Conversaciones con actividad."
          onClick={() => navigate("/inbox")}
        />
        <StatCard
          title="Pendientes"
          value={loading ? 0 : pendingConfirm}
          hint="Revisar y confirmar citas."
          onClick={() => navigate("/agenda")}
        />
        <StatCard
          title="Follow-ups hoy"
          value={loading ? 0 : followupsToday}
          hint="Contactar antes que se enfríe."
          onClick={() => navigate("/inbox")}
        />
        <StatCard
          title="Sin respuesta"
          value={loading ? 0 : noBotReply}
          hint="Leads esperando respuesta."
          onClick={() => navigate("/inbox")}
        />
      </div>

      <SectionCard title="Actividad reciente" description="Últimos mensajes capturados.">
        {recent.length === 0 ? (
          <div className="text-sm text-white/60">Sin actividad.</div>
        ) : (
          <div className="grid gap-2">
            {recent.map((m) => (
              <div
                key={m.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-white/50">
                      {m.actor === "user" ? "Usuario" : "Bot"}
                    </div>
                    <div className="truncate text-sm font-semibold text-white">
                      {m.content || "—"}
                    </div>
                  </div>
                  <div className="text-[11px] text-white/40">
                    {new Date(m.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}