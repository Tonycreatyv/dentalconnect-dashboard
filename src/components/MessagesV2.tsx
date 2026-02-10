import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type MessageV2 = {
  id: string;
  platform: string;
  sender_id: string;
  content: string;
  created_at: string;
};

export default function MessagesV2() {
  const [messages, setMessages] = useState<MessageV2[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMessages = async () => {
      const { data, error } = await supabase
        .from("messages_v2")
        .select("id, platform, sender_id, content, created_at")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        console.error("❌ messages_v2 error:", error);
      } else {
        setMessages(data ?? []);
      }

      setLoading(false);
    };

    loadMessages();
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-400">Loading messages…</p>;
  }

  if (!messages.length) {
    return <p className="text-sm text-slate-400">No messages yet.</p>;
  }

  return (
    <div className="space-y-3">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3"
        >
          <div className="flex justify-between text-xs text-slate-500">
            <span>{msg.platform}</span>
            <span>{new Date(msg.created_at).toLocaleString()}</span>
          </div>
          <p className="mt-2 text-sm text-slate-200">{msg.content}</p>
        </div>
      ))}
    </div>
  );
}
