-- Locked core: single producer/consumer reliability for messaging pipeline.

alter table public.reply_outbox
  add column if not exists processing_started_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists attempts integer default 0,
  add column if not exists attempt_count integer default 0,
  add column if not exists inbound_provider_message_id text,
  add column if not exists message_text text;

alter table public.leads
  add column if not exists avatar_url text;

alter table public.messages
  add column if not exists provider_message_id text;

create table if not exists public.followup_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  lead_id uuid not null,
  channel_user_id text not null,
  provider text not null default 'meta',
  payload jsonb not null default '{}'::jsonb,
  reason text null,
  step integer not null default 1,
  max_steps integer not null default 3,
  due_at timestamptz not null default now(),
  status text not null default 'queued',
  locked_at timestamptz null,
  lock_owner text null,
  attempts integer not null default 0,
  sent_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists reply_outbox_org_inbound_provider_mid_unique
on public.reply_outbox (organization_id, inbound_provider_message_id)
where inbound_provider_message_id is not null;

create index if not exists reply_outbox_claim_ready_idx_v2
on public.reply_outbox (organization_id, status, scheduled_for, locked_at, claimed_at);

create index if not exists followup_outbox_claim_ready_idx_v2
on public.followup_outbox (organization_id, status, due_at, locked_at);

create unique index if not exists followup_outbox_org_lead_reason_step_unique
on public.followup_outbox (organization_id, lead_id, coalesce(reason, ''), step)
where status in ('queued', 'processing');

drop trigger if exists messages_enqueue_reply_outbox on public.messages;
drop trigger if exists trg_messages_enqueue_reply_outbox on public.messages;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.reply_outbox'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.reply_outbox drop constraint if exists %I', c.conname);
  end loop;

  alter table public.reply_outbox
    add constraint reply_outbox_status_check
    check (status in ('pending', 'queued', 'processing', 'sent', 'failed', 'error', 'paused', 'skipped'));
end $$;

create or replace function public.claim_reply_outbox_jobs_v2(
  p_org_id text,
  p_limit int,
  p_lock_owner text,
  p_lock_ttl_seconds int
)
returns setof public.reply_outbox
language plpgsql
security definer
as $$
declare
  v_limit int := greatest(coalesce(p_limit, 10), 1);
  v_ttl interval := make_interval(secs => greatest(coalesce(p_lock_ttl_seconds, 300), 30));
begin
  return query
  with candidates as (
    select r.id
    from public.reply_outbox r
    where r.organization_id = p_org_id
      and (
        (r.status in ('queued', 'pending') and coalesce(r.scheduled_for, r.created_at, now()) <= now())
        or
        (r.status = 'processing' and coalesce(r.locked_at, r.claimed_at, r.processing_started_at, r.updated_at, r.created_at) < now() - v_ttl)
      )
      and coalesce(r.scheduled_for, r.created_at, now()) <= now()
      and (
        r.locked_at is null
        or r.locked_at < (now() - v_ttl)
      )
      and (
        r.claimed_at is null
        or r.claimed_at < (now() - v_ttl)
      )
    order by coalesce(r.scheduled_for, r.created_at, now()) asc, r.created_at asc
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.reply_outbox r
    set
      status = 'processing',
      processing_started_at = coalesce(r.processing_started_at, now()),
      claimed_at = now(),
      claimed_by = p_lock_owner,
      locked_at = now(),
      locked_by = p_lock_owner,
      attempt_count = coalesce(r.attempt_count, 0) + 1,
      updated_at = now()
    from candidates c
    where r.id = c.id
    returning r.*
  )
  select * from claimed;
end;
$$;

grant execute on function public.claim_reply_outbox_jobs_v2(text, int, text, int) to service_role;
grant execute on function public.claim_reply_outbox_jobs_v2(text, int, text, int) to authenticated;

create or replace function public.reply_outbox_requeue_stuck(
  p_org text,
  p_ttl interval
)
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer := 0;
begin
  with requeued as (
    update public.reply_outbox r
    set
      status = 'queued',
      claimed_at = null,
      claimed_by = null,
      locked_at = null,
      locked_by = null,
      processing_started_at = null,
      updated_at = now(),
      last_error = coalesce(r.last_error, 'requeued_stuck')
    where r.organization_id = p_org
      and r.status = 'processing'
      and coalesce(r.processing_started_at, r.locked_at, r.claimed_at, r.updated_at, r.created_at) < now() - p_ttl
    returning 1
  )
  select count(*) into v_count from requeued;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.reply_outbox_requeue_stuck(text, interval) to service_role;
grant execute on function public.reply_outbox_requeue_stuck(text, interval) to authenticated;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.followup_outbox'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.followup_outbox drop constraint if exists %I', c.conname);
  end loop;

  alter table public.followup_outbox
    add constraint followup_outbox_status_check
    check (status in ('queued', 'processing', 'sent', 'failed', 'cancelled', 'skipped'));
end $$;

create or replace function public.claim_followup_outbox_jobs_v2(
  p_org_id text,
  p_limit int,
  p_lock_owner text,
  p_lock_ttl_seconds int
)
returns setof public.followup_outbox
language plpgsql
security definer
as $$
declare
  v_limit int := greatest(coalesce(p_limit, 10), 1);
  v_ttl interval := make_interval(secs => greatest(coalesce(p_lock_ttl_seconds, 300), 30));
begin
  return query
  with candidates as (
    select f.id
    from public.followup_outbox f
    where f.organization_id = p_org_id
      and f.status = 'queued'
      and f.due_at <= now()
      and (f.locked_at is null or f.locked_at < (now() - v_ttl))
    order by f.due_at asc, f.created_at asc
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.followup_outbox f
    set
      status = 'processing',
      locked_at = now(),
      lock_owner = p_lock_owner,
      attempts = coalesce(f.attempts, 0) + 1,
      updated_at = now()
    from candidates c
    where f.id = c.id
    returning f.*
  )
  select * from claimed;
end;
$$;

grant execute on function public.claim_followup_outbox_jobs_v2(text, int, text, int) to service_role;
grant execute on function public.claim_followup_outbox_jobs_v2(text, int, text, int) to authenticated;
