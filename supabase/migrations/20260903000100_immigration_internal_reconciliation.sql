-- Incremental reconciliation for the internal Luis Immigration circuit.
--
-- This intentionally assumes the materialized operational baseline already
-- exists remotely. It is not a replay of the missing historical migrations:
-- it adds only the contract used by run-replies and the internal inbox.
begin;

-- Fail before making any change if this is not the audited operational base.
do $$
declare
  required_table text;
  required_column text;
  legacy_constraint text;
  actor_constraint_count integer;
begin
  foreach required_table in array array[
    'organizations', 'leads', 'org_members',
    'referral_service_requests', 'referral_operational_events'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'immigration_reconciliation_missing_table:%', required_table;
    end if;
  end loop;

  foreach required_column in array array[
    'referral_service_requests.organization_id',
    'referral_service_requests.lead_id',
    'referral_service_requests.service_id',
    'referral_service_requests.completion_key',
    'referral_service_requests.status',
    'referral_service_requests.intake',
    'referral_service_requests.consent',
    'organizations.id',
    'leads.id',
    'leads.organization_id',
    'leads.channel',
    'leads.channel_user_id',
    'org_members.organization_id',
    'org_members.user_id',
    'org_members.role',
    'referral_operational_events.organization_id',
    'referral_operational_events.aggregate_id',
    'referral_operational_events.aggregate_type',
    'referral_operational_events.event_type',
    'referral_operational_events.actor_type',
    'referral_operational_events.idempotency_key'
  ] loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = split_part(required_column, '.', 1)
        and c.column_name = split_part(required_column, '.', 2)
    ) then
      raise exception 'immigration_reconciliation_missing_column:%', required_column;
    end if;
  end loop;

  if to_regclass('public.referral_requests_one_active_service') is null then
    raise exception 'immigration_reconciliation_missing_active_request_index';
  end if;
  if to_regclass('public.referral_operational_events_idempotency') is null then
    raise exception 'immigration_reconciliation_missing_event_idempotency_index';
  end if;
  if to_regprocedure('public.referral_is_member(text,text[])') is null then
    raise exception 'immigration_reconciliation_missing_membership_function';
  end if;

  select conname into legacy_constraint
  from pg_constraint
  where conrelid = 'public.referral_service_requests'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, lead_id, service_id, completion_key)';
  if legacy_constraint is null then
    raise exception 'immigration_reconciliation_expected_legacy_completion_constraint_missing';
  end if;

  select count(*) into actor_constraint_count
  from pg_constraint
  where conrelid = 'public.referral_operational_events'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%actor_type%';
  if actor_constraint_count <> 1 then
    raise exception 'immigration_reconciliation_expected_one_actor_type_constraint_found:%', actor_constraint_count;
  end if;
end;
$$;

-- Existing requests become the first case cycle. The legacy unique constraint
-- is stricter than the new one, so this preserves every existing request.
alter table public.referral_service_requests add column case_cycle integer;
update public.referral_service_requests set case_cycle = 1 where case_cycle is null;
alter table public.referral_service_requests alter column case_cycle set default 1;
alter table public.referral_service_requests alter column case_cycle set not null;
alter table public.referral_service_requests
  add constraint referral_service_requests_case_cycle_positive check (case_cycle > 0);

do $$
declare legacy_constraint text;
begin
  select conname into legacy_constraint
  from pg_constraint
  where conrelid = 'public.referral_service_requests'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, lead_id, service_id, completion_key)';
  if legacy_constraint is null then
    raise exception 'immigration_reconciliation_expected_legacy_completion_constraint_missing';
  end if;
  execute format('alter table public.referral_service_requests drop constraint %I', legacy_constraint);
end;
$$;
alter table public.referral_service_requests
  add constraint referral_service_requests_completion_cycle_unique
  unique (organization_id, lead_id, service_id, completion_key, case_cycle);

-- Preserve the original actor categories and make service-originated captures
-- distinguishable in the immutable operational audit trail.
do $$
declare actor_constraint text;
begin
  select conname into actor_constraint
  from pg_constraint
  where conrelid = 'public.referral_operational_events'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%actor_type%';
  if actor_constraint is null then
    raise exception 'immigration_reconciliation_actor_type_constraint_missing';
  end if;
  execute format('alter table public.referral_operational_events drop constraint %I', actor_constraint);
end;
$$;
alter table public.referral_operational_events
  add constraint referral_operational_events_actor_type_check
  check (actor_type in ('system', 'service_role', 'user', 'partner', 'provider'));

create function public.referral_reject_operational_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'referral_operational_events_are_immutable' using errcode = '42501';
end;
$$;
revoke all on function public.referral_reject_operational_event_mutation() from public, anon, authenticated;
create trigger referral_operational_events_immutable
before update or delete on public.referral_operational_events
for each row execute function public.referral_reject_operational_event_mutation();

-- The RPC's external signature matches the bridge in run-replies. It creates
-- no assignment, partner access token, notification, or external side effect.
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
    raise exception 'referral_immigration_capture_tenant_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'referral_immigration_capture_organization_not_found' using errcode = 'P0002';
  end if;
  if nullif(trim(p_channel_user_id), '') is null
    or p_completion_key <> 'luis_unified_services:immigration:v1'
    or nullif(trim(p_delivery_key), '') is null
    or p_completed_at is null
    or jsonb_typeof(coalesce(p_intake, '{}'::jsonb)) <> 'object'
    or p_intake->>'source' <> 'whatsapp_flow'
    or p_intake->>'flow_type' <> 'luis_unified_services'
    or p_intake->>'flow_version' <> 'v1'
    or p_intake->>'intake_type' <> 'IMMIGRATION'
    or nullif(trim(p_intake->>'topic'), '') is null
    or nullif(trim(p_intake->>'description'), '') is null then
    raise exception 'referral_immigration_capture_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id || ':' || p_lead_id::text || ':luis_inmigracion', 0
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
    and idempotency_key = 'immigration-flow:' || p_delivery_key
  limit 1;
  if replay_request_id is not null then
    select * into request_row
    from public.referral_service_requests
    where id = replay_request_id and organization_id = p_organization_id;
    if not found then
      raise exception 'immigration_delivery_replay_request_missing' using errcode = 'P0002';
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

  select * into request_row
  from public.referral_service_requests
  where organization_id = p_organization_id
    and lead_id = p_lead_id
    and service_id = 'luis_inmigracion'
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
        updated_at = now()
    where id = request_row.id
    returning * into request_row;
    event_type := 'immigration_flow_request_updated';
  else
    select coalesce(max(case_cycle), 0) + 1 into next_cycle
    from public.referral_service_requests
    where organization_id = p_organization_id
      and lead_id = p_lead_id
      and service_id = 'luis_inmigracion';

    insert into public.referral_service_requests(
      organization_id, lead_id, service_id, source_channel, postal_code,
      language, intake, intake_complete, consent, status, completion_key, case_cycle
    ) values (
      p_organization_id, p_lead_id, 'luis_inmigracion', 'whatsapp',
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
    event_type := 'immigration_flow_request_created';
  end if;

  insert into public.referral_operational_events(
    organization_id, aggregate_type, aggregate_id, event_type, actor_type,
    source, new_state, metadata, idempotency_key
  ) values (
    p_organization_id, 'request', request_row.id, event_type, 'service_role',
    'capture_immigration_flow_request',
    jsonb_build_object(
      'status', request_row.status,
      'intake_complete', request_row.intake_complete,
      'case_cycle', request_row.case_cycle
    ),
    jsonb_build_object(
      'flow_type', p_intake->>'flow_type',
      'flow_version', p_intake->>'flow_version',
      'completed_at', p_completed_at
    ),
    'immigration-flow:' || p_delivery_key
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
revoke all on function public.capture_immigration_flow_request(text, uuid, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.capture_immigration_flow_request(text, uuid, text, text, text, timestamptz, jsonb) to service_role;

-- Browser clients may read only their own organization's requests. Existing
-- organization membership is used unchanged; onboarding is deliberately out
-- of this narrow reconciliation slice.
alter table public.referral_service_requests enable row level security;
alter table public.referral_operational_events enable row level security;
revoke all on table public.referral_service_requests from public, anon, authenticated;
revoke all on table public.referral_operational_events from public, anon, authenticated;
grant select on table public.referral_service_requests to authenticated;
grant select on table public.referral_operational_events to authenticated;
grant all on table public.referral_service_requests to service_role;
grant all on table public.referral_operational_events to service_role;

drop policy referral_requests_member_read on public.referral_service_requests;
create policy referral_requests_internal_read
on public.referral_service_requests
for select to authenticated
using (public.referral_is_member(organization_id, array['owner', 'admin', 'operator']));

commit;
