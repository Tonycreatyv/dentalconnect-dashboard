import { stableHash } from "./dedupe";

type MessageLike = {
  id?: string | null;
  created_at?: string | null;
  actor?: string | null;
  role?: string | null;
  direction?: string | null;
  content?: string | null;
  body?: string | null;
  text?: string | null;
  platform_message_id?: string | null;
  source_message_id?: string | null;
};

export function messageKey(msg: MessageLike) {
  if (msg.id) return msg.id;
  const platformId = msg.platform_message_id ?? msg.source_message_id;
  if (platformId) return platformId;

  const created = msg.created_at ? new Date(msg.created_at) : null;
  const minute = created && !isNaN(created.getTime()) ? Math.floor(created.getTime() / 60000) : 0;
  const direction = msg.direction ?? msg.actor ?? msg.role ?? "unknown";
  const text = msg.content ?? msg.body ?? msg.text ?? "";
  const prefix = text.slice(0, 32);
  return stableHash(`${direction}::${minute}::${prefix}`);
}
