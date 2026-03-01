-- Ensure inbound channel user id is persisted on messages and used by reply outbox trigger.

alter table public.messages
  add column if not exists channel_user_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'lead_id'
  ) then
    update public.messages m
    set channel_user_id = l.channel_user_id
    from public.leads l
    where m.channel = 'messenger'
      and lower(coalesce(m.role, '')) = 'user'
      and coalesce(m.channel_user_id, '') = ''
      and m.lead_id = l.id
      and m.organization_id = l.organization_id
      and coalesce(l.channel_user_id, '') <> '';
  end if;
end $$;

delete from public.reply_outbox
where lower(coalesce(channel_user_id, '')) = 'user';

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
  v_channel_user_id text := nullif(trim(coalesce(new.channel_user_id, '')), '');
  v_lead_id uuid;
  v_job_id uuid;
begin
  if v_role <> 'user' or v_channel <> 'messenger' then
    return new;
  end if;

  if v_org is null or v_provider_mid is null or v_channel_user_id is null or lower(v_channel_user_id) = 'user' then
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
    v_channel_user_id,
    v_provider_mid,
    jsonb_build_object(
      'source', 'messages_trigger',
      'message_id', new.id,
      'recipient_id', v_channel_user_id,
      'channel_user_id', v_channel_user_id,
      'inbound_text', coalesce(new.content, '')
    )
  );

  raise log '[messages->reply_outbox] org=% provider_message_id=% channel_user_id=% job_id=%', v_org, v_provider_mid, v_channel_user_id, v_job_id;
  return new;
end;
$$;
