import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

export type OperationsMessage = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  channel: string | null;
  channel_user_id: string | null;
  actor: string | null;
  role: string | null;
  content: string | null;
  created_at: string;
};

export function useReferralOperations() {
  const { resolvedOrgId } = useReferralOrganization();
  const [messages, setMessages] = useState<OperationsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!resolvedOrgId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const result = await supabase
      .from("messages")
      .select("id,organization_id,lead_id,channel,channel_user_id,actor,role,content,created_at")
      .eq("organization_id", resolvedOrgId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (result.error) {
      setError("No se pudieron cargar las conversaciones.");
      setMessages([]);
    } else {
      setMessages((result.data ?? []) as OperationsMessage[]);
    }
    setLoading(false);
  }, [resolvedOrgId]);

  useEffect(() => { void load(); }, [load]);

  const sendMessage = useCallback(async ({
    leadId,
    channel,
    channelUserId,
    content,
  }: {
    leadId: string;
    channel: string;
    channelUserId?: string | null;
    content: string;
  }) => {
    if (!resolvedOrgId || !leadId || !content.trim()) return { ok: false, message: "Faltan datos para enviar." };
    if (!channelUserId || !["messenger", "whatsapp"].includes(channel)) return { ok: false, message: "La conversación no tiene un destino válido." };
    const result = await supabase.functions.invoke("referral-manual-message", { body: {
      organization_id: resolvedOrgId, lead_id: leadId, channel, channel_user_id: channelUserId,
      text: content.trim(), idempotency_key: crypto.randomUUID(),
    } });
    if (result.error || !result.data?.queued) return { ok: false, message: "No se pudo poner el mensaje en la cola de entrega." };
    await load();
    return { ok: true, deliveryStatus: "queued" };
  }, [load, resolvedOrgId]);

  const byLead = useMemo(() => {
    const grouped = new Map<string, OperationsMessage[]>();
    for (const message of [...messages].reverse()) {
      if (!message.lead_id) continue;
      const current = grouped.get(message.lead_id) ?? [];
      current.push(message);
      grouped.set(message.lead_id, current);
    }
    return grouped;
  }, [messages]);

  return { messages, byLead, loading, error, load, sendMessage };
}
