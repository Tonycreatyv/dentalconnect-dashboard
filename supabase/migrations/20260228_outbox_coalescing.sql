-- Outbox coalescing: 1 queued job per org+lead

create unique index if not exists reply_outbox_one_queued_per_lead
on public.reply_outbox (organization_id, lead_id)
where status = 'queued';

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

  return v_id;
end;
$$;
