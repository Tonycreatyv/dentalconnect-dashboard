// src/components/ChatMessage.tsx
export type Msg = {
  id: string;
  actor?: string | null; // "user" | "bot" | "staff"
  role?: string | null;  // "user" | "assistant"
  content: string;
  created_at?: string | null;
};

function normActor(m: Msg) {
  const a = String(m.actor ?? "").toLowerCase().trim();
  const r = String(m.role ?? "").toLowerCase().trim();

  // prioriza actor si viene, si no role
  if (a) return a;
  if (r === "assistant") return "bot";
  return "user";
}

export function ChatMessage({
  m,
  patientLabel,
}: {
  m: Msg;
  patientLabel: string;
}) {
  const actor = normActor(m);
  const isPatient = actor === "user";

  const rowClass = isPatient ? "msg-row msg-left" : "msg-row msg-right";
  const bubbleClass = isPatient ? "bubble bubble-patient" : "bubble bubble-clinic";
  const label = isPatient ? patientLabel : "";

  const time = m.created_at
    ? new Date(m.created_at).toLocaleString("es-HN", { hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <div className={rowClass}>
      <div className="msg-stack">
        {label ? <div className="msg-label">{label}</div> : null}

        <div className={bubbleClass}>
          {m.content}
          {time ? <div className="msg-time">{time}</div> : null}
        </div>
      </div>
    </div>
  );
}
