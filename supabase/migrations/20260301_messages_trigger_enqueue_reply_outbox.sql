-- Robust enqueue for inbound Messenger messages via DB trigger.
-- Uses provider_message_id as inbound key.

alter table public.reply_outbox
  add column if not exists inbound_message_id text;

create unique index if not exists reply_outbox_org_inbound_message_uidx
on public.reply_outbox (organization_id, inbound_message_id)
where inbound_message_id is not null;

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
      check (status in ('pending', 'queued', 'processing', 'sent', 'failed', 'error', 'paused'));
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
      inbound_message_id,
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
      p_inbound_provider_message_id,
      coalesce(p_payload, '{}'::jsonb),
      'pending',
      now(),
      now()
    )
    on conflict (organization_id, inbound_message_id) where inbound_message_id is not null
    do update set
      payload = excluded.payload,
      updated_at = now()
    returning id into v_id;
  exception
    when unique_violation then
      select id
      into v_id
      from public.reply_outbox
      where organization_id = p_organization_id
        and inbound_message_id = p_inbound_provider_message_id
      order by coalesce(updated_at, created_at) desc, created_at desc
      limit 1;
  end;

  return v_id;
end;
$$;

create or replace function public.trg_enqueue_reply_outbox_from_messages()
returns trigger
language plpgsql
security definer
as $$
declare
  v_role text := lower(coalesce(new.role, ''));
  v_channel text := lower(coalesce(new.channel, ''));
  v_provider_mid text := nullif(trim(coalesce(new.provider_message_id, '')), '');
  v_org text := nullif(trim(coalesce(new.organization_id, '')), '');
  v_lead_id uuid;
  v_job_id uuid;
begin
  if v_role <> 'user' or v_channel <> 'messenger' then
    return new;
  end if;

  if v_org is null or v_provider_mid is null then
    return new;
  end if;

  begin
    v_lead_id := nullif((to_jsonb(new)->>'lead_id'), '')::uuid;
  exception
    when others then
      v_lead_id := null;
  end;

  v_job_id := public.enqueue_reply_job(
    v_org,
    v_lead_id,
    'messenger',
    nullif(trim(coalesce((to_jsonb(new)->>'channel_user_id'), '')), ''),
    v_provider_mid,
    jsonb_build_object(
      'source', 'messages_trigger',
      'message_id', new.id,
      'inbound_text', coalesce(new.content, '')
    )
  );

  raise log '[messages->reply_outbox] org=% provider_message_id=% job_id=%', v_org, v_provider_mid, v_job_id;
  return new;
end;
$$;

drop trigger if exists trg_messages_enqueue_reply_outbox on public.messages;

create trigger trg_messages_enqueue_reply_outbox
after insert on public.messages
for each row
execute function public.trg_enqueue_reply_outbox_from_messages();
