// src/pages/ChatThread.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import "../styles/chat.css";
import { supabase } from "../lib/supabase";

type DbMessage = {
  id: string;
  role: string | null;
  actor: string | null;
  content: string | null;
  created_at: string | null;
};

type LeadRow = {
  id: string;
  full_name: string | null;
};

function normalizeActor(m: DbMessage): "user" | "bot" | "staff" {
  const a = String(m.actor ?? "").toLowerCase().trim();
  const r = String(m.role ?? "").toLowerCase().trim();

  if (a === "staff") return "staff";
  if (a === "bot") return "bot";
  if (a === "user") return "user";

  if (r === "assistant") return "bot";
  return "user";
}

function timeLabel(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("es-HN", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function ChatThread() {
  const { leadId } = useParams();

  const [lead, setLead] = useState<LeadRow | null>(null);
  const [rows, setRows] = useState<DbMessage[]>([]);
  const [text, setText] = useState("");

  const patientLabel = useMemo(() => {
    const n = lead?.full_name?.trim();
    return n ? n : "Paciente";
  }, [lead]);

  async function loadLead() {
    if (!leadId) return;
    const res = await supabase
      .from("leads")
      .select("id, full_name")
      .eq("id", leadId)
      .maybeSingle();

    if (!res.error) setLead((res.data as LeadRow) ?? null);
  }

  async function loadMessages() {
    if (!leadId) return;

    const res = await supabase
      .from("messages")
      .select("id, role, actor, content, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })
      .limit(400);

    if (!res.error && res.data) setRows(res.data as DbMessage[]);
  }

  useEffect(() => {
    loadLead();
    loadMessages();

    const t = setInterval(() => {
      loadLead();
      loadMessages();
    }, 1500);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function send() {
    if (!leadId) return;
    const v = text.trim();
    if (!v) return;

    setText("");

    // ✅ Enviar como staff (clínica), NO como user
    const ins = await supabase.from("messages").insert({
      lead_id: leadId,
      actor: "staff",
      role: "assistant",
      content: v,
    });

    if (!ins.error) await loadMessages();
  }

  return (
    <div className="chat-page">
      <div className="chat-scroll">
        {rows.map((m) => {
          const actor = normalizeActor(m);
          const isPatient = actor === "user";
          const rowSide = isPatient ? "left" : "right";
          const bubbleClass = isPatient ? "bubble bubble-patient" : "bubble bubble-clinic";
          const label = isPatient ? patientLabel : "";

          return (
            <div key={m.id} className={`msg-row ${rowSide}`}>
              <div>
                {label ? <div className="msg-label text-white/70">{label}</div> : null}

                <div className={bubbleClass}>
                  {String(m.content ?? "")}
                  <div className="msg-time">
                    {timeLabel(m.created_at)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="chat-dock">
        <div className="chat-dock-inner">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe tu respuesta..."
            className="chat-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button onClick={send} className="chat-btn">
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
