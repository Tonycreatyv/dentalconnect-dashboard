-- Luis micro-intake V1: extends canonical operational capture (previously
-- immigration-only) to AUTO_ACCIDENT, DUI, and CRIMINAL. Each keeps its own
-- distinct canonical intake_type and its own consent gate; all three share
-- the existing luis_accidente service_id (already an allowed value on
-- orchestrate_referral_service_request's own check — no new service_id is
-- introduced). Purely additive: capture_immigration_flow_request,
-- auto_assign_immigration_partner, and every existing immigration RLS policy
-- are left completely untouched. partner_update_immigration_assignment gets
-- one narrow widening (its service_id guard) so partners can act on the new
-- assignments through the exact same RPC the frontend already calls.
begin;

do $$
begin
  if to_regprocedure('public.capture_immigration_flow_request(text,uuid,text,text,text,timestamptz,jsonb)') is null then
    raise exception 'luis_micro_intake_missing_capture_immigration_flow_request';
  end if;
  if to_regprocedure('public.auto_assign_immigration_partner(uuid,text)') is null then
    raise exception 'luis_micro_intake_missing_auto_assign_immigration_partner';
  end if;
  if to_regprocedure('public.partner_update_immigration_assignment(uuid,text,text,timestamptz)') is null then
    raise exception 'luis_micro_intake_missing_partner_update_immigration_assignment';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'referral_service_requests' and column_name = 'case_cycle'
  ) then
    raise exception 'luis_micro_intake_missing_case_cycle';
  end if;
end $$;

-- Mirrors capture_immigration_flow_request's contract exactly (service_role
-- only, tenant-locked to luis-gabriel-referral-hub, advisory lock, replay via
-- idempotency_key, case_cycle handling, consent derivation from
-- sharing_consent) — generalized only by accepting which of the three legal
-- intake types this completion is. The lock key and completion_key are both
-- scoped by p_intake_type so AUTO_ACCIDENT/DUI/CRIMINAL never collide with
-- each other even though they currently share service_id='luis_accidente'.
create or replace function public.capture_legal_flow_request(
  p_organization_id text,
  p_lead_id uuid,
  p_channel_user_id text,
  p_intake_type text,
  p_completion_key text,
  p_delivery_key text,
  p_completed_at timestamptz,
  p_intake jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lead_row public.leads%rowtype;
  request_row public.referral_service_requests%rowtype;
  replay_request_id uuid;
  next_cycle integer;
  request_created boolean := false;
  event_type text;
  consent_status text;
  consent_captured boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_organization_id <> 'luis-gabriel-referral-hub' then
    raise exception 'referral_legal_capture_tenant_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'referral_legal_capture_organization_not_found' using errcode = 'P0002';
  end if;
  if p_intake_type not in ('AUTO_ACCIDENT', 'DUI', 'CRIMINAL') then
    raise exception 'referral_legal_capture_intake_type_forbidden' using errcode = '22023';
  end if;
  if nullif(trim(p_channel_user_id), '') is null
    or nullif(trim(p_completion_key), '') is null
    or nullif(trim(p_delivery_key), '') is null
    or p_completed_at is null
    or jsonb_typeof(coalesce(p_intake, '{}'::jsonb)) <> 'object'
    or p_intake->>'source' <> 'whatsapp_flow'
    or p_intake->>'flow_type' <> 'luis_unified_services'
    or p_intake->>'intake_type' <> p_intake_type
    or nullif(trim(p_intake->>'description'), '') is null then
    raise exception 'referral_legal_capture_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id || ':' || p_lead_id::text || ':luis_accidente:' || p_intake_type, 0
  ));

  select * into lead_row
  from public.leads
  where id = p_lead_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'referral_lead_not_found' using errcode = 'P0002';
  end if;
  if coalesce(to_jsonb(lead_row)->>'channel', '') <> 'whatsapp'
    or coalesce(to_jsonb(lead_row)->>'channel_user_id', '') <> p_channel_user_id then
    raise exception 'referral_conversation_identity_mismatch' using errcode = '42501';
  end if;

  select aggregate_id into replay_request_id
  from public.referral_operational_events
  where organization_id = p_organization_id
    and aggregate_type = 'request'
    and idempotency_key = 'legal-flow:' || p_delivery_key
  limit 1;
  if replay_request_id is not null then
    select * into request_row
    from public.referral_service_requests
    where id = replay_request_id and organization_id = p_organization_id;
    if not found then
      raise exception 'legal_delivery_replay_request_missing' using errcode = 'P0002';
    end if;
    return jsonb_build_object(
      'success', true,
      'request_id', request_row.id,
      'request_status', request_row.status,
      'created', false,
      'assigned', false,
      'notification_created', false,
      'idempotent_replay', true,
      'case_cycle', request_row.case_cycle
    );
  end if;

  consent_status := case p_intake->>'sharing_consent'
    when 'AUTHORIZED' then 'authorized'
    when 'DECLINED' then 'declined'
    else 'pending_review'
  end;
  consent_captured := consent_status in ('authorized', 'declined');

  -- Deliberately matched by (org, lead, service_id, active status) only —
  -- NOT completion_key — mirroring capture_immigration_flow_request's own
  -- lookup exactly. referral_requests_one_active_service is a partial
  -- unique index on (organization_id, lead_id, service_id) with no
  -- completion_key in it, so at most one ACTIVE request can ever exist per
  -- (lead, service_id) regardless of completion_key: AUTO_ACCIDENT, DUI, and
  -- CRIMINAL sharing service_id='luis_accidente' means at most one of the
  -- three can be active per lead at a time. A second, different-intake_type
  -- completion while the first is still active UPDATES (replaces) that same
  -- row rather than colliding on insert — exactly how a lead re-completing
  -- immigration with a different topic already behaves today. Nothing is
  -- silently lost: every completion is independently, immutably logged in
  -- referral_operational_events regardless of which one "wins" the current
  -- referral_service_requests row. See migration header comment / the
  -- accompanying implementation report for why this is accepted as a
  -- reported, temporary V1 limitation rather than a schema change tonight.
  select * into request_row
  from public.referral_service_requests
  where organization_id = p_organization_id
    and lead_id = p_lead_id
    and service_id = 'luis_accidente'
    and status in ('new', 'collecting', 'prequalified', 'qualified')
  order by created_at desc
  limit 1
  for update;

  if found then
    update public.referral_service_requests
    set source_channel = 'whatsapp',
        postal_code = nullif(trim(p_intake->>'postal_code'), ''),
        language = nullif(trim(p_intake->>'language'), ''),
        intake = p_intake,
        intake_complete = true,
        consent = jsonb_build_object(
          'status', consent_status,
          'captured', consent_captured,
          'captured_at', case when consent_captured then p_completed_at else null end,
          'version', nullif(trim(p_intake->>'consent_version'), ''),
          'source', nullif(trim(p_intake->>'consent_source'), '')
        ),
        status = 'prequalified',
        completion_key = p_completion_key,
        updated_at = now()
    where id = request_row.id
    returning * into request_row;
    event_type := 'legal_flow_request_updated';
  else
    select coalesce(max(case_cycle), 0) + 1 into next_cycle
    from public.referral_service_requests
    where organization_id = p_organization_id
      and lead_id = p_lead_id
      and service_id = 'luis_accidente';

    insert into public.referral_service_requests(
      organization_id, lead_id, service_id, source_channel, postal_code,
      language, intake, intake_complete, consent, status, completion_key, case_cycle
    ) values (
      p_organization_id, p_lead_id, 'luis_accidente', 'whatsapp',
      nullif(trim(p_intake->>'postal_code'), ''),
      nullif(trim(p_intake->>'language'), ''), p_intake, true,
      jsonb_build_object(
        'status', consent_status,
        'captured', consent_captured,
        'captured_at', case when consent_captured then p_completed_at else null end,
        'version', nullif(trim(p_intake->>'consent_version'), ''),
        'source', nullif(trim(p_intake->>'consent_source'), '')
      ),
      'prequalified', p_completion_key, next_cycle
    ) returning * into request_row;
    request_created := true;
    event_type := 'legal_flow_request_created';
  end if;

  insert into public.referral_operational_events(
    organization_id, aggregate_type, aggregate_id, event_type, actor_type,
    source, new_state, metadata, idempotency_key
  ) values (
    p_organization_id, 'request', request_row.id, event_type, 'service_role',
    'capture_legal_flow_request',
    jsonb_build_object(
      'status', request_row.status,
      'intake_complete', request_row.intake_complete,
      'case_cycle', request_row.case_cycle
    ),
    jsonb_build_object(
      'intake_type', p_intake_type,
      'flow_type', p_intake->>'flow_type',
      'flow_version', p_intake->>'flow_version',
      'completed_at', p_completed_at
    ),
    'legal-flow:' || p_delivery_key
  );

  return jsonb_build_object(
    'success', true,
    'request_id', request_row.id,
    'request_status', request_row.status,
    'created', request_created,
    'assigned', false,
    'notification_created', false,
    'idempotent_replay', false,
    'case_cycle', request_row.case_cycle
  );
end;
$$;
revoke all on function public.capture_legal_flow_request(text, uuid, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.capture_legal_flow_request(text, uuid, text, text, text, text, timestamptz, jsonb) to service_role;

-- Mirrors auto_assign_immigration_partner exactly, except the service_id
-- check/lookup reads the request's own service_id rather than a hardcoded
-- 'luis_inmigracion' — usable for any legal service_id in the future, only
-- exercised for luis_accidente in V1. Only service_role invokes this after a
-- successful AUTHORIZED capture; creates neither notification nor access
-- token, same as its immigration counterpart.
create or replace function public.auto_assign_legal_partner(p_request_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.referral_service_requests%rowtype; rule public.referral_partner_service_rules%rowtype;
  assignment public.referral_assignments%rowtype; next_attempt integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select * into r from public.referral_service_requests where id=p_request_id for update;
  if not found then raise exception 'legal_request_not_found' using errcode='P0002'; end if;
  if r.service_id<>'luis_accidente' or coalesce(r.consent->>'status','pending_review')<>'authorized' then
    return jsonb_build_object('assigned',false,'reason','consent_or_service_not_eligible');
  end if;
  select * into assignment from public.referral_assignments where organization_id=r.organization_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('assigned',true,'assignment_id',assignment.id,'idempotent_replay',true); end if;
  select * into assignment from public.referral_assignments where request_id=r.id and status in ('pending_assignment','assigned','accepted') order by created_at desc limit 1;
  if found then return jsonb_build_object('assigned',true,'assignment_id',assignment.id,'idempotent_replay',true); end if;
  select x.* into rule from public.referral_partner_service_rules x join public.referral_partners p on p.id=x.partner_id and p.organization_id=x.organization_id
   where x.organization_id=r.organization_id and x.service_id=r.service_id and x.active and p.active and p.partnership_status='active'
   order by x.assignment_priority,x.id for update of x skip locked limit 1;
  if not found then
    insert into public.referral_operational_exceptions(organization_id,aggregate_type,aggregate_id,exception_type,severity,summary,details)
    values(r.organization_id,'request',r.id,'legal_partner_unconfigured','high','No hay aliado activo configurado para este servicio legal',jsonb_build_object('service_id',r.service_id));
    insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,source,metadata,idempotency_key)
    values(r.organization_id,'request',r.id,'legal_assignment_unavailable','service_role','auto_assign_legal_partner','{}'::jsonb,p_idempotency_key||':exception');
    return jsonb_build_object('assigned',false,'reason','no_active_partner');
  end if;
  select coalesce(max(attempt_number),0)+1 into next_attempt from public.referral_assignments where request_id=r.id;
  insert into public.referral_assignments(organization_id,request_id,partner_id,assignment_mode,assignment_rule,assignment_reason,attempt_number,idempotency_key,assigned_by_type,status,work_status)
  values(r.organization_id,r.id,rule.partner_id,'automatic','legal_authorized_partner',jsonb_build_object('service_id',r.service_id),next_attempt,p_idempotency_key,'system','assigned','new') returning * into assignment;
  insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,source,new_state,metadata,idempotency_key)
  values(r.organization_id,'assignment',assignment.id,'legal_assignment_created','service_role','auto_assign_legal_partner',to_jsonb(assignment),jsonb_build_object('request_id',r.id),p_idempotency_key||':event');
  return jsonb_build_object('assigned',true,'assignment_id',assignment.id,'idempotent_replay',false);
end $$;
revoke all on function public.auto_assign_legal_partner(uuid,text) from public,anon,authenticated;
grant execute on function public.auto_assign_legal_partner(uuid,text) to service_role;

-- Partner reads its new legal referrals through the exact same policy shape
-- already proven for immigration — additive policy, the existing
-- referral_requests_partner_authorized_read policy for luis_inmigracion is
-- untouched. Never broadens access beyond: authorized consent, this
-- service_id, and an assignment to a partner the reading user is an active
-- member of (referral_is_active_partner_member, already existing).
create policy referral_requests_partner_authorized_read_legal on public.referral_service_requests
  for select to authenticated using (
    service_id = 'luis_accidente'
    and coalesce(consent->>'status', 'pending_review') = 'authorized'
    and exists (
      select 1 from public.referral_assignments a
      where a.request_id = referral_service_requests.id and a.organization_id = referral_service_requests.organization_id
        and public.referral_is_active_partner_member(a.organization_id, a.partner_id)
    )
  );

-- Narrow widening only: partner_update_immigration_assignment's own
-- service_id guard now also accepts luis_accidente, so a partner can run
-- accept/contacted/etc. on the new legal assignments through the exact same
-- RPC the frontend already calls. Every other line is byte-identical to the
-- existing function (20260904000100_immigration_partner_dashboard.sql).
create or replace function public.partner_update_immigration_assignment(
  p_assignment_id uuid, p_action text, p_note text default null, p_appointment_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.referral_assignments%rowtype; before_state jsonb; event_name text; next_status text; next_work_status text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_action not in ('accept','reject','contacted','no_answer','appointment_scheduled','converted','closed_not_converted','note') then raise exception 'invalid_partner_action' using errcode='22023'; end if;
  select * into a from public.referral_assignments where id=p_assignment_id for update;
  if not found or not public.referral_is_active_partner_member(a.organization_id,a.partner_id) then raise exception 'partner_assignment_access_denied' using errcode='42501'; end if;
  if not exists(select 1 from public.referral_service_requests r where r.id=a.request_id and r.service_id in ('luis_inmigracion','luis_accidente') and coalesce(r.consent->>'status','')='authorized') then raise exception 'partner_assignment_not_authorized_immigration' using errcode='42501'; end if;
  before_state:=to_jsonb(a); next_status:=a.status; next_work_status:=a.work_status;
  if p_action='accept' then if a.status<>'assigned' then raise exception 'invalid_assignment_transition'; end if; next_status:='accepted';
  elsif p_action='reject' then if a.status not in ('assigned','accepted') or nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'invalid_assignment_rejection'; end if; next_status:='rejected';
  elsif p_action in ('contacted','no_answer','appointment_scheduled','converted','closed_not_converted') then
    if a.status<>'accepted' then raise exception 'assignment_must_be_accepted'; end if;
    -- `no_answer` is an auditable contact attempt, not a terminal work state
    -- in the materialized operational enum/check contract.
    next_work_status:=case p_action when 'closed_not_converted' then 'not_converted' when 'no_answer' then a.work_status else p_action end;
  end if;
  update public.referral_assignments set status=next_status,work_status=next_work_status,accepted_at=case when p_action='accept' then now() else accepted_at end,rejected_at=case when p_action='reject' then now() else rejected_at end,rejection_reason=case when p_action='reject' then trim(p_note) else rejection_reason end,updated_at=now() where id=a.id returning * into a;
  event_name:='partner_'||p_action;
  insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,source,previous_state,new_state,metadata)
  values(a.organization_id,'assignment',a.id,event_name,'partner',auth.uid(),'partner_update_immigration_assignment',before_state,to_jsonb(a),jsonb_build_object('note',nullif(trim(coalesce(p_note,'')),''),'appointment_at',p_appointment_at));
  return jsonb_build_object('assignment_id',a.id,'status',a.status,'work_status',a.work_status);
end $$;

commit;
