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
  provider_message_id: string | null;
};

// The reply_outbox row that processed a given inbound message carries the
// customer's real submitted Flow fields in payload.flow_response — the
// messages table itself has no such column. Keyed by
// inbound_provider_message_id, which is the same value stored on the
// triggering inbound messages row's provider_message_id (see
// enqueue_reply_outbox_from_message in
// supabase/migrations/20260301_golden_reply_outbox_trigger.sql).
export type FlowResponseRecord = {
  payload: Record<string, unknown> | null;
  status: string | null;
};

export function useReferralOperations() {
  const { resolvedOrgId } = useReferralOrganization();
  const [messages, setMessages] = useState<OperationsMessage[]>([]);
  const [flowResponseByProviderMessageId, setFlowResponseByProviderMessageId] = useState<Map<string, FlowResponseRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!resolvedOrgId) {
      setMessages([]);
      setFlowResponseByProviderMessageId(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [messagesResult, outboxResult] = await Promise.all([
      supabase
        .from("messages")
        .select("id,organization_id,lead_id,channel,channel_user_id,actor,role,content,created_at,provider_message_id")
        .eq("organization_id", resolvedOrgId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("reply_outbox")
        .select("inbound_provider_message_id,payload,status")
        .eq("organization_id", resolvedOrgId)
        .not("inbound_provider_message_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    if (messagesResult.error) {
      setError("No se pudieron cargar las conversaciones.");
      setMessages([]);
    } else {
      setMessages((messagesResult.data ?? []) as OperationsMessage[]);
    }
    if (!outboxResult.error) {
      const nextMap = new Map<string, FlowResponseRecord>();
      for (const row of (outboxResult.data ?? []) as Array<{ inbound_provider_message_id: string | null; payload: unknown; status: string | null }>) {
        if (!row.inbound_provider_message_id || nextMap.has(row.inbound_provider_message_id)) continue;
        const payload = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : null;
        const flowResponse = payload && payload.flow_response && typeof payload.flow_response === "object"
          ? payload.flow_response as Record<string, unknown>
          : null;
        nextMap.set(row.inbound_provider_message_id, { payload: flowResponse, status: row.status });
      }
      setFlowResponseByProviderMessageId(nextMap);
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

  return { messages, byLead, flowResponseByProviderMessageId, loading, error, load, sendMessage };
}
