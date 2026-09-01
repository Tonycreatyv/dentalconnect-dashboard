export type HumanTakeoverSource = "human_replied_from_dashboard" | "human_replied_from_whatsapp_app";

export type HumanTakeoverState = {
  conversation_mode?: string | null;
  bot_paused_until?: string | null;
  paused_reason?: string | null;
  last_human_message_at?: string | null;
  last_human_actor?: string | null;
};

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

export function activateHumanTakeoverState(args: {
  state: Record<string, unknown> | null | undefined;
  source: HumanTakeoverSource;
  actor: string;
  nowIso?: string;
  pauseMinutes?: number;
}): Record<string, unknown> {
  const now = safeStr(args.nowIso) || new Date().toISOString();
  const pauseMinutes = Math.max(1, Number(args.pauseMinutes ?? 60) || 60);
  const pausedUntil = new Date(Date.parse(now) + pauseMinutes * 60 * 1000).toISOString();
  const base = args.state && typeof args.state === "object" ? { ...args.state } : {};
  return {
    ...base,
    conversation_mode: "human_active",
    bot_paused_until: pausedUntil,
    paused_reason: args.source,
    last_human_message_at: now,
    last_human_actor: args.actor || "human",
  };
}

export function isHumanTakeoverActive(state: HumanTakeoverState | null | undefined, nowIso?: string): boolean {
  if (!state || safeStr(state.conversation_mode) !== "human_active") return false;
  const pausedUntil = safeStr(state.bot_paused_until);
  if (!pausedUntil) return false;
  const now = Date.parse(nowIso || new Date().toISOString());
  const until = Date.parse(pausedUntil);
  if (!Number.isFinite(now) || !Number.isFinite(until)) return false;
  return until > now;
}

export function shouldAllowAutomationDuringTakeover(args: {
  payloadAction?: string | null;
  payloadSource?: string | null;
  isOperatorOutbound?: boolean;
}): { allowed: boolean; reason?: string } {
  const action = safeStr(args.payloadAction).toLowerCase();
  const source = safeStr(args.payloadSource).toLowerCase();
  if (args.isOperatorOutbound) return { allowed: true, reason: "manual_outbound" };
  if (source.includes("followup") || source.includes("reminder")) return { allowed: true, reason: "followup_or_reminder" };
  if (source.includes("template") || source.includes("transactional")) return { allowed: true, reason: "template" };
  if (action) {
    if (action.includes("flow") || action.includes("start_flow") || action.includes("open_flow")) {
      return { allowed: true, reason: "flow_allowed_during_takeover" };
    }
    return { allowed: false, reason: "payload_action_not_flow" };
  }
  return { allowed: false, reason: "free_text_blocked" };
}
