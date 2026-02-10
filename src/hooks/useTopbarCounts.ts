import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export type TopbarCounts = {
  unreadThreads: number;
  apptsToday: number;
  outboxPending: number;
};

function toISO(d: Date) {
  return d.toISOString();
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export function useTopbarCounts(clinicId: string | null) {
  const [counts, setCounts] = useState<TopbarCounts>({
    unreadThreads: 0,
    apptsToday: 0,
    outboxPending: 0,
  });
  const [loading, setLoading] = useState(false);

  const todayMinISO = useMemo(() => toISO(startOfToday()), []);
  const todayMaxISO = useMemo(() => toISO(endOfToday()), []);

  const reloadTimer = useRef<number | null>(null);

  const load = async () => {
    if (!clinicId) return;

    setLoading(true);
    try {
      // 1) unread threads (calculado en JS para evitar comparaciones columna/columna en PostgREST)
      const leadsRes = await supabase
        .from("leads")
        .select("id, last_message_at, last_staff_seen_at")
        .eq("organization_id", clinicId)
        .order("last_message_at", { ascending: false })
        .limit(1000);

      const leads = (leadsRes.data ?? []) as any[];

      const unreadThreads = leads.filter((l) => {
        const lm = l.last_message_at ? new Date(l.last_message_at).getTime() : 0;
        const seen = l.last_staff_seen_at ? new Date(l.last_staff_seen_at).getTime() : 0;
        return lm > 0 && lm > seen;
      }).length;

      // 2) citas de hoy
      const apptsRes = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", clinicId)
        .gte("start_at", todayMinISO)
        .lte("start_at", todayMaxISO);

      // 3) outbox pending/processing
      const outboxRes = await supabase
        .from("reply_outbox")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", clinicId)
        .in("status", ["pending", "processing"]);

      setCounts({
        unreadThreads,
        apptsToday: apptsRes.count ?? 0,
        outboxPending: outboxRes.count ?? 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const scheduleReload = () => {
    if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      load();
    }, 250);
  };

  useEffect(() => {
    if (!clinicId) return;

    load();

    // Realtime: cualquier insert/update relevante => recargar counts
    const ch = supabase
      .channel(`topbar:${clinicId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `organization_id=eq.${clinicId}` },
        () => scheduleReload()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `organization_id=eq.${clinicId}` },
        () => scheduleReload()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reply_outbox", filter: `organization_id=eq.${clinicId}` },
        () => scheduleReload()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  return { counts, loading, refresh: load };
}
