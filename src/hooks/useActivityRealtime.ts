import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useActivity } from "../context/ActivityContext";

type MessageRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  channel: string | null;
  role: string;
  content: string;
  created_at: string;
};

type OutboxRow = {
  id: string;
  organization_id: string;
  lead_id: string;
  status: "pending" | "processing" | "sent" | "failed";
  message_text: string | null;
  updated_at: string;
};

export function useActivityRealtime(organizationId: string | null) {
  const { push } = useActivity();
  const orgRef = useRef(organizationId);
  orgRef.current = organizationId;

  useEffect(() => {
    if (!organizationId) return;

    // 1) Mensajes entrantes/salientes
    const ch = supabase
      .channel(`activity:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          const row = payload.new as MessageRow;

          // Solo “vida” real: si entra mensaje de user, notifícalo.
          if (row.role === "user") {
            push({
              level: "info",
              title: `Mensaje entrante (${row.channel ?? "unknown"})`,
              detail: row.content?.slice(0, 120),
              ts: row.created_at,
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "reply_outbox",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          const next = payload.new as OutboxRow;
          const prev = payload.old as OutboxRow | undefined;

          // Solo avisar cambios de status (evita spam)
          if (prev?.status && prev.status === next.status) return;

          if (next.status === "processing") {
            push({
              level: "info",
              title: "Procesando respuesta",
              detail: next.message_text?.slice(0, 120) ?? undefined,
              ts: next.updated_at,
            });
          } else if (next.status === "sent") {
            push({
              level: "success",
              title: "Respuesta enviada",
              detail: next.message_text?.slice(0, 120) ?? undefined,
              ts: next.updated_at,
            });
          } else if (next.status === "failed") {
            push({
              level: "error",
              title: "Falló el envío",
              detail: next.message_text?.slice(0, 120) ?? undefined,
              ts: next.updated_at,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [organizationId, push]);
}
