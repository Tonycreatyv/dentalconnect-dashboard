type LeadLike = {
  channel_user_id?: string | null;
  name?: string | null;
  full_name?: string | null;
  state?: Record<string, any> | null;
};

function psidSuffix(channelUserId?: string | null) {
  const raw = (channelUserId ?? "").replace(/\D/g, "");
  if (!raw) return "0000";
  return raw.slice(-4).padStart(4, "0");
}

export function getLeadDisplayName(lead: LeadLike) {
  const state = (lead.state ?? {}) as Record<string, any>;
  const fromState = typeof state.name === "string" ? state.name.trim() : "";
  const fromName = typeof lead.name === "string" ? lead.name.trim() : "";
  const fromFullName = typeof lead.full_name === "string" ? lead.full_name.trim() : "";
  const fromSlots =
    state?.slots && typeof state.slots === "object" && typeof state.slots.name === "string"
      ? state.slots.name.trim()
      : "";

  if (fromState) return fromState;
  if (fromName) return fromName;
  if (fromFullName) return fromFullName;
  if (fromSlots) return fromSlots;
  return `Usuario ${psidSuffix(lead.channel_user_id)}`;
}
