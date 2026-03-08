export type AppointmentStatus = "pending" | "confirmed" | "cancelled" | "rescheduled";

export type AppointmentPayload = {
  id: string;
  organization_id: string;
  lead_id: string;
  channel: string;
  start_at: string | null;
  end_at: string | null;
  status: AppointmentStatus;
  calendar_event_id?: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export function buildAppointmentPayload(args: {
  organization_id: string;
  lead_id: string;
  channel?: string;
  start_at?: string;
  end_at?: string;
  source?: string;
  status?: AppointmentStatus;
}): AppointmentPayload {
  const now = new Date().toISOString();
  return {
    id: `${args.lead_id}-${Date.now()}`,
    organization_id: args.organization_id,
    lead_id: args.lead_id,
    channel: args.channel ?? "messenger",
    start_at: args.start_at ?? null,
    end_at: args.end_at ?? null,
    status: args.status ?? "pending",
    source: args.source ?? "run_replies",
    created_at: now,
    updated_at: now,
  };
}
