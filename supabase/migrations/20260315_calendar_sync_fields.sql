alter table if exists public.appointments
  add column if not exists calendar_provider text null,
  add column if not exists calendar_id text null,
  add column if not exists calendar_event_id text null,
  add column if not exists calendar_sync_status text not null default 'pending',
  add column if not exists calendar_sync_error text null,
  add column if not exists calendar_last_synced_at timestamptz null;

create index if not exists appointments_calendar_provider_idx on public.appointments (calendar_provider);
create index if not exists appointments_calendar_id_idx on public.appointments (calendar_id);
