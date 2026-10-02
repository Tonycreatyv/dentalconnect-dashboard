-- Phase A (multi-org safety): replace the literal single-tenant gate in the
-- two live Flow-completion capture RPCs with a generic, data-driven
-- capability check.
--
-- Revision: the first draft of this migration keyed the capability check
-- off referral_partner_service_rules.active. That's wrong — it couples two
-- independent concepts. referral_partner_service_rules answers "who
-- currently receives this service" (routing, a partner-relationship
-- lifecycle: partners get paused, swapped, re-negotiated). It does not
-- answer "is this organization allowed to use this Referral Hub service at
-- all" (capability, an organization-level product/billing decision). Under
-- the first draft, pausing or removing Clínica Pastor's routing rule would
-- have made every Luis auto-accident Flow submission fail outright — the
-- customer would see an error instead of a captured, pending request. That
-- is exactly the regression this revision removes.
--
-- No existing table already models "organization_id + service_id +
-- enabled" as a standalone concept: organizations has no capability
-- columns at all (id, name, created_at, owner_id only — verified live this
-- session); org_settings' ~47 columns are all messaging/billing/business-
-- type config, nothing per-Referral-Hub-service; no other local migration
-- defines anything matching this shape (checked every CREATE TABLE across
-- supabase/migrations/*.sql). A live full-table-list re-check to rule out
-- remote-only drift was attempted and blocked by a transient tool outage
-- this session — flagging that as the one unconfirmed point, not something
-- silently assumed; re-run it before this migration is ever applied.
--
-- Smallest new table: referral_organization_services(organization_id,
-- service_id, enabled). No partner_id, no routing priority, no pricing/
-- quota/campaign fields — it answers exactly one question and nothing
-- else. Seeded below with the two services the live organization already
-- has active routing rules for, so production behavior is unchanged.
--
-- Capture authorization is now: organization exists AND
-- referral_organization_services says this org+service is enabled.
-- Routing (referral_partner_service_rules) is untouched and stays fully
-- independent — a paused/missing routing rule now surfaces exactly as it
-- already does downstream (auto_assign_*'s existing "no active partner"
-- -> referral_operational_exceptions path), never as a capture failure.
--
-- This changes WHO may reach the capture logic, never WHAT it writes or
-- WHERE it routes: every other check (auth.role, intake shape, consent
-- mapping, advisory lock, replay handling, insert/update columns, event
-- logging) is copied verbatim from the freshly re-verified live bodies.
--
-- orchestrate_referral_service_request is intentionally NOT touched here:
-- traced its full live call graph (routeLuisConversation in luisBenefits.ts,
-- the actual live router) and confirmed it never imports or reaches
-- genericMenuRouter.ts, which is the only place in the codebase that still
-- emits the 'referral_hub:accident_complete'/'referral_hub:immigration_
-- complete' debug notes that function's caller depends on. Those two paths
-- are dormant in production today. Its liveness for luis_eventos/
-- luis_representante was not re-traced in this pass, so its tenant gate is
-- left exactly as-is rather than guessed at.
begin;

do $$
begin
  if to_regprocedure('public.capture_immigration_flow_request(text,uuid,text,text,text,timestamptz,jsonb)') is null
    or to_regprocedure('public.capture_legal_flow_request(text,uuid,text,text,text,text,timestamptz,jsonb)') is null
    or to_regclass('public.organizations') is null then
    raise exception 'referral_hub_multiorg_capture_authorization_baseline_missing';
  end if;
end $$;

-- Answers exactly one question: can this organization capture this
-- Referral Hub service at all. Nothing about routing, partners, pricing,
-- or campaigns belongs here — that's referral_partner_service_rules'
-- job, unchanged and untouched by this migration.
create table if not exists public.referral_organization_services (
  organization_id text not null references public.organizations(id) on delete cascade,
  service_id text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, service_id)
);

alter table public.referral_organization_services enable row level security;
revoke all on public.referral_organization_services from public, anon, authenticated;
grant all on public.referral_organization_services to service_role;

-- Seed exactly the two services the live organization already has active
-- routing rules for today (verified live this session), so this migration
-- cannot change current production behavior. on conflict do nothing keeps
-- this safe to re-run.
insert into public.referral_organization_services (organization_id, service_id, enabled)
values
  ('luis-gabriel-referral-hub', 'luis_inmigracion', true),
  ('luis-gabriel-referral-hub', 'luis_accidente', true)
on conflict (organization_id, service_id) do nothing;

create or replace function public.capture_immigration_flow_request(p_organization_id text, p_lead_id uuid, p_channel_user_id text, p_completion_key text, p_delivery_key text, p_completed_at timestamp with time zone, p_intake jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'referral_immigration_capture_organization_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.referral_organization_services
    where organization_id = p_organization_id and service_id = 'luis_inmigracion' and enabled
  ) then
    raise exception 'referral_immigration_capture_service_not_enabled' using errcode = '42501';
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
$function$;

create or replace function public.capture_legal_flow_request(p_organization_id text, p_lead_id uuid, p_channel_user_id text, p_intake_type text, p_completion_key text, p_delivery_key text, p_completed_at timestamp with time zone, p_intake jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'referral_legal_capture_organization_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.referral_organization_services
    where organization_id = p_organization_id and service_id = 'luis_accidente' and enabled
  ) then
    raise exception 'referral_legal_capture_service_not_enabled' using errcode = '42501';
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
  -- three can be active per lead at a time. Unchanged from the live
  -- definition — this phase does not touch the DUI/Criminal split.
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
$function$;

-- Signatures are unchanged (same argument lists as the live definitions), so
-- CREATE OR REPLACE above already preserved the existing grants — no REVOKE/
-- GRANT needed here, unlike a signature-changing migration would require.

commit;
