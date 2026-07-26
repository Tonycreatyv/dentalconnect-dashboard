import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

export default function ReferralMessages() {
  const { resolvedOrgId } = useReferralOrganization();
  const [messages, setMessages] = useState<Array<{ id: string; body: string | null; direction: string | null; created_at: string }>>([]);
  useEffect(() => {
    if (!resolvedOrgId) return;
    void supabase.from("messages").select("id,body,direction,created_at")
      .eq("organization_id", resolvedOrgId).order("created_at", { ascending: false })
      .limit(50).then(({ data }) => setMessages((data || []) as typeof messages));
  }, [resolvedOrgId]);
  return <main className="referral-page"><h1 className="text-xl font-black text-white">Mensajes</h1><div className="mt-4 grid gap-2">{messages.map((message) => <article key={message.id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white"><span className="text-xs text-white/40">{message.direction}</span><p>{message.body || "Mensaje interactivo"}</p></article>)}</div></main>;
}
