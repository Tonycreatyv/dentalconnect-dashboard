-- Waitlist + Alerts + cancellation alert trigger (safe additive migration)

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  type text not null,
  severity text not null default 'info',
  title text not null,
  body text null,
  action jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz null
);

create index if not exists alerts_org_status_created_idx
  on public.alerts (organization_id, status, created_at desc);

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  lead_id uuid null,
  service_type text null,
  time_pref text null,
  priority int not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.waitlist add column if not exists organization_id text;
alter table public.waitlist add column if not exists lead_id uuid;
alter table public.waitlist add column if not exists service_type text;
alter table public.waitlist add column if not exists time_pref text;
alter table public.waitlist add column if not exists priority int default 0;
alter table public.waitlist add column if not exists status text default 'active';
alter table public.waitlist add column if not exists created_at timestamptz default now();

create index if not exists waitlist_org_status_priority_idx
  on public.waitlist (organization_id, status, priority desc, created_at asc);

create table if not exists public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  appointment_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists appointment_events_org_created_idx
  on public.appointment_events (organization_id, created_at desc);

create or replace function public.create_waitlist_offer_alert_on_cancel()
returns trigger
language plpgsql
security definer
as $$
declare
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_service text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if coalesce(old.status, '') is distinct from coalesce(new.status, '')
     and lower(coalesce(new.status, '')) = 'cancelled' then
    v_slot_start := coalesce(new.start_at, new.starts_at);
    v_slot_end := coalesce(new.start_at, new.starts_at) + interval '1 hour';
    v_service := nullif(coalesce(new.reason, new.title, ''), '');

    insert into public.appointment_events(
      organization_id,
      appointment_id,
      event_type,
      payload
    ) values (
      new.organization_id,
      new.id,
      'cancelled',
      jsonb_build_object(
        'slot_start', v_slot_start,
        'slot_end', v_slot_end,
        'service_type', coalesce(v_service, 'general')
      )
    );

    insert into public.alerts(
      organization_id,
      type,
      severity,
      title,
      body,
      action,
      status
    ) values (
      new.organization_id,
      'waitlist_offer_ready',
      'warning',
      'Hueco liberado',
      format('Se liberó un turno para %s', coalesce(v_service, 'servicio general')),
      jsonb_build_object(
        'slot_start', v_slot_start,
        'slot_end', v_slot_end,
        'service_type', coalesce(v_service, 'general'),
        'appointment_id', new.id
      ),
      'open'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_waitlist_offer_alert on public.appointments;
create trigger appointments_waitlist_offer_alert
after update on public.appointments
for each row
execute function public.create_waitlist_offer_alert_on_cancel();
