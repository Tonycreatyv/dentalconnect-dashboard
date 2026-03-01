-- GOLDEN schema for Messenger enqueue pipeline
-- messages -> trigger -> reply_outbox

create extension if not exists pgcrypto;

alter table public.messages
  add column if not exists channel_user_id text;

alter table public.reply_outbox
  add column if not exists processing_started_at timestamptz,
  add column if not exists scheduled_for timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists provider_payload jsonb,
  add column if not exists client_msg_id uuid,
  add column if not exists attempt_count integer default 0,
  add column if not exists attempts integer default 0,
  add column if not exists message_text text;

update public.reply_outbox
set scheduled_for = coalesce(scheduled_for, created_at, now())
where scheduled_for is null;

update public.messages m
set channel_user_id = l.channel_user_id
from public.leads l
where m.channel = 'messenger'
  and lower(coalesce(m.role, '')) = 'user'
  and coalesce(m.channel_user_id, '') = ''
  and m.lead_id = l.id
  and m.organization_id = l.organization_id
  and coalesce(l.channel_user_id, '') <> '';

create unique index if not exists reply_outbox_org_inbound_provider_uidx
on public.reply_outbox (organization_id, inbound_provider_message_id)
where inbound_provider_message_id is not null;

delete from public.reply_outbox
where lower(coalesce(channel_user_id, '')) = 'user';

create or replace function public.enqueue_reply_outbox_from_message()
returns trigger
language plpgsql
security definer
as $$
declare
  v_psid text;
begin
  if lower(coalesce(new.channel, '')) <> 'messenger' then
    return new;
  end if;
  if lower(coalesce(new.role, '')) <> 'user' then
    return new;
  end if;
  if nullif(trim(coalesce(new.provider_message_id, '')), '') is null then
    return new;
  end if;

  v_psid := nullif(trim(coalesce(new.channel_user_id, '')), '');
  if v_psid is null and new.lead_id is not null then
    select nullif(trim(coalesce(l.channel_user_id, '')), '')
    into v_psid
    from public.leads l
    where l.id = new.lead_id
      and l.organization_id = new.organization_id
    limit 1;
  end if;

  if v_psid is null or lower(v_psid) = 'user' then
    return new;
  end if;

  insert into public.reply_outbox (
    organization_id,
    lead_id,
    channel,
    channel_user_id,
    inbound_message_id,
    inbound_provider_message_id,
    message_text,
    payload,
    status,
    scheduled_for,
    attempts,
    attempt_count,
    client_msg_id,
    created_at,
    updated_at
  )
  values (
    new.organization_id,
    new.lead_id,
    'messenger',
    v_psid,
    new.id,
    new.provider_message_id,
    coalesce(new.content, ''),
    jsonb_build_object(
      'text', coalesce(new.content, ''),
      'recipient', jsonb_build_object('id', v_psid),
      'recipient_id', v_psid
    ),
    'queued',
    now(),
    0,
    0,
    gen_random_uuid(),
    now(),
    now()
  )
  on conflict (organization_id, inbound_provider_message_id)
  where inbound_provider_message_id is not null
  do nothing;

  return new;
end;
$$;

drop trigger if exists messages_enqueue_reply_outbox on public.messages;
create trigger messages_enqueue_reply_outbox
after insert on public.messages
for each row
execute function public.enqueue_reply_outbox_from_message();
