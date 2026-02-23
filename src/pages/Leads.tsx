import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { SectionCard } from "../components/SectionCard";

const ORG = "clinic-demo";

type LeadRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  status: string | null;
  channel: string | null;
  last_intent: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
};

export default function Leads() {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, full_name, phone, status, channel, last_intent, last_message_at, last_message_preview"
      )
      .eq("organization_id", ORG)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(300);

    if (!error && data) setRows(data as any);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Realtime: si entra mensaje, recargás leads
  useEffect(() => {
    const channel = supabase
      .channel(`rt-leads-${ORG}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `organization_id=eq.${ORG}`,
        },
        async () => {
          await load();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SectionCard title="Leads" description="Lista de leads (preview + último mensaje).">
      {loading ? (
        <div className="text-sm text-slate-400">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-400">
          No hay leads visibles. Si en Supabase sí hay datos, es RLS (policies).
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.03] text-white/60">
              <tr>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Último</th>
                <th className="px-4 py-3">Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{r.full_name ?? "Sin nombre"}</div>
                    <div className="text-xs text-white/50">{r.phone ?? ""}</div>
                  </td>
                  <td className="px-4 py-3 text-white/70">{r.channel ?? "—"}</td>
                  <td className="px-4 py-3 text-white/70">
                    {r.last_message_at ? new Date(r.last_message_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-white/70">{r.last_message_preview ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}