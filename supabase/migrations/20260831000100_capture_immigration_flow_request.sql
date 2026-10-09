-- Immigration Flow capture bridge.
-- This deliberately records an internal-review request only. It never calls
-- the assignment, notification, partner-token, or follow-up paths.
begin;

create or replace function public.capture_immigration_flow_request(
  p_organization_id text,
  p_lead_id uuid,
  p_channel_user_id text,
  p_completion_key text,
  p_delivery_key text,
  p_completed_at timestamptz,
  p_intake jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  lead_row public.leads%rowtype;
  request_row public.referral_service_requests%rowtype;
  request_created boolean := false;
  event_type text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if p_organization_id <> 'luis-gabriel-referral-hub' then
    raise exception 'referral_immigration_capture_tenant_forbidden' using errcode='42501';
  end if;
  if nullif(trim(p_channel_user_id), '') is null
    or nullif(trim(p_completion_key), '') is null
    or nullif(trim(p_delivery_key), '') is null
    or p_completed_at is null
    or jsonb_typeof(coalesce(p_intake, '{}'::jsonb)) <> 'object'
    or p_intake->>'intake_type' <> 'IMMIGRATION'
    or nullif(trim(p_intake->>'topic'), '') is null
    or nullif(trim(p_intake->>'description'), '') is null then
    raise exception 'referral_immigration_capture_invalid' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id || ':' || p_lead_id::text || ':luis_inmigracion', 0
  ));

  select * into lead_row
  from public.leads
  where id=p_lead_id and organization_id=p_organization_id
  for update;
  if not found then
    raise exception 'referral_lead_not_found' using errcode='P0002';
  end if;
  if coalesce(to_jsonb(lead_row)->>'channel', '') <> 'whatsapp'
    or coalesce(to_jsonb(lead_row)->>'channel_user_id', '') <> p_channel_user_id then
    raise exception 'referral_conversation_identity_mismatch' using errcode='42501';
  end if;

  select * into request_row
  from public.referral_service_requests
  where organization_id=p_organization_id
    and lead_id=p_lead_id
    and service_id='luis_inmigracion'
    and status in ('new','collecting','prequalified','qualified')
  order by created_at desc
  limit 1
  for update;

  if found then
    update public.referral_service_requests
    set source_channel='whatsapp',
        postal_code=nullif(trim(p_intake->>'postal_code'), ''),
        language=nullif(trim(p_intake->>'language'), ''),
        intake=p_intake,
        intake_complete=true,
        -- The published Flow captures no legal disclosure consent. Keep that
        -- fact explicit and prevent downstream automation from treating this
        -- request as assignment-ready.
        consent=jsonb_build_object('status','pending_review','captured',false),
        status='prequalified',
        updated_at=now()
    where id=request_row.id
    returning * into request_row;
    event_type := 'immigration_flow_request_updated';
  else
    insert into public.referral_service_requests(
      organization_id,lead_id,service_id,source_channel,postal_code,language,
      intake,intake_complete,consent,status,completion_key
    ) values (
      p_organization_id,p_lead_id,'luis_inmigracion','whatsapp',
      nullif(trim(p_intake->>'postal_code'), ''),
      nullif(trim(p_intake->>'language'), ''),p_intake,true,
      jsonb_build_object('status','pending_review','captured',false),
      'prequalified',p_completion_key
    ) returning * into request_row;
    request_created := true;
    event_type := 'immigration_flow_request_created';
  end if;

  insert into public.referral_operational_events(
    organization_id,aggregate_type,aggregate_id,event_type,actor_type,source,
    new_state,metadata,idempotency_key
  ) values (
    p_organization_id,'request',request_row.id,event_type,'system',
    'capture_immigration_flow_request',
    jsonb_build_object('status',request_row.status,'intake_complete',request_row.intake_complete),
    jsonb_build_object('flow_type','luis_unified_services','flow_version','v1','completed_at',p_completed_at),
    'immigration-flow:' || p_delivery_key
  ) on conflict do nothing;

  return jsonb_build_object(
    'success',true,
    'request_id',request_row.id,
    'request_status',request_row.status,
    'created',request_created,
    'assigned',false,
    'notification_created',false
  );
end;
$$;

revoke all on function public.capture_immigration_flow_request(text,uuid,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.capture_immigration_flow_request(text,uuid,text,text,text,timestamptz,jsonb) to service_role;

commit;
