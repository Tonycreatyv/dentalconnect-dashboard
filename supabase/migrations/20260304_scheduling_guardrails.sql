-- Scheduling guardrails: avoid double booking + reminder event dedupe

create unique index if not exists appointments_org_slot_unique_active
  on public.appointments (organization_id, coalesce(start_at, starts_at))
  where status not in ('cancelled');

create unique index if not exists appointment_events_org_appt_type_unique
  on public.appointment_events (organization_id, appointment_id, event_type);

create index if not exists appointments_org_start_status_idx
  on public.appointments (organization_id, coalesce(start_at, starts_at), status);
