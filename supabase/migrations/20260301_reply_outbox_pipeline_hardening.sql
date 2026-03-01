-- Pipeline hardening for Messenger reply outbox

alter table public.reply_outbox
  add column if not exists attempts integer not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists outbound_message_id uuid,
  add column if not exists meta_message_id text,
  add column if not exists last_error text,
  add column if not exists inbound_provider_message_id text;

with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, inbound_provider_message_id
      order by coalesce(updated_at, created_at) desc, created_at desc, id desc
    ) as rn
  from public.reply_outbox
  where inbound_provider_message_id is not null
)
delete from public.reply_outbox r
using ranked d
where r.id = d.id
  and d.rn > 1;

create unique index if not exists reply_outbox_unique_inbound_provider_mid
on public.reply_outbox (organization_id, inbound_provider_message_id)
where inbound_provider_message_id is not null;

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

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reply_outbox'::regclass
      and conname = 'reply_outbox_status_check'
  ) then
    alter table public.reply_outbox
      add constraint reply_outbox_status_check
      check (status in ('pending', 'queued', 'processing', 'sent', 'error', 'failed', 'paused'));
  end if;
end $$;

create or replace function public.enqueue_reply_job(
  p_organization_id text,
  p_lead_id uuid,
  p_channel text,
  p_channel_user_id text,
  p_inbound_provider_message_id text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  begin
    insert into public.reply_outbox (
      organization_id,
      lead_id,
      channel,
      channel_user_id,
      inbound_provider_message_id,
      payload,
      status,
      created_at,
      updated_at
    )
    values (
      p_organization_id,
      p_lead_id,
      p_channel,
      p_channel_user_id,
      p_inbound_provider_message_id,
      coalesce(p_payload, '{}'::jsonb),
      'queued',
      now(),
      now()
    )
    on conflict (organization_id, lead_id) where status = 'queued'
    do update set
      inbound_provider_message_id = excluded.inbound_provider_message_id,
      channel = excluded.channel,
      channel_user_id = excluded.channel_user_id,
      payload = excluded.payload,
      updated_at = now()
    returning id into v_id;
  exception
    when unique_violation then
      select id
      into v_id
      from public.reply_outbox
      where organization_id = p_organization_id
        and inbound_provider_message_id = p_inbound_provider_message_id
      order by coalesce(updated_at, created_at) desc, created_at desc
      limit 1;

      if v_id is null then
        raise;
      end if;
  end;

  return v_id;
end;
$$;
