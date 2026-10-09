-- Phase 0: tenant access, partner identities, controlled audit append, and
-- closed-case-safe Immigration Flow idempotency. Depends on:
--   20260801000100_referral_operations_pilot.sql
--   20260831000100_capture_immigration_flow_request.sql
begin;

-- Existing internal memberships are retained. The active flag is additive so
-- legacy onboarding remains compatible while access checks can disable a user.
alter table public.org_members add column if not exists active boolean not null default true;

create table if not exists public.referral_partner_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  partner_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('partner_admin','partner_agent')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, partner_id, user_id),
  constraint referral_partner_memberships_partner_fk
    foreign key (organization_id, partner_id)
    references public.referral_partners(organization_id, id) on delete cascade
);
create index if not exists referral_partner_memberships_user_active_idx
  on public.referral_partner_memberships(user_id, organization_id, partner_id)
  where active;

-- Existing events retain their actor type. New service-role boundaries can be
-- distinguished from ordinary background-system actions.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid='public.referral_operational_events'::regclass
      and contype='c' and pg_get_constraintdef(oid) like '%actor_type%'
  loop
    execute format('alter table public.referral_operational_events drop constraint %I', constraint_name);
  end loop;
end $$;
alter table public.referral_operational_events
  add constraint referral_operational_events_actor_type_check
  check (actor_type in ('system','service_role','user','partner','provider'));

-- A closed request is a completed case cycle. A new deliberate Flow completion
-- may open a later cycle; retried delivery of the original completion does not.
alter table public.referral_service_requests
  add column if not exists case_cycle integer not null default 1
  check (case_cycle > 0);
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid='public.referral_service_requests'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, lead_id, service_id, completion_key)'
  loop
    execute format('alter table public.referral_service_requests drop constraint %I', constraint_name);
  end loop;
end $$;
alter table public.referral_service_requests
  add constraint referral_service_requests_completion_cycle_unique
  unique (organization_id, lead_id, service_id, completion_key, case_cycle);

create or replace function public.referral_is_member(
  p_organization_id text,
  p_roles text[] default null
) returns boolean
language sql stable security definer set search_path=public,pg_temp
as $$
  select exists(
    select 1 from public.org_members m
    where m.organization_id=p_organization_id
      and m.user_id=auth.uid()
      and m.active
      and (p_roles is null or m.role=any(p_roles))
  );
$$;
revoke all on function public.referral_is_member(text,text[]) from public,anon;
grant execute on function public.referral_is_member(text,text[]) to authenticated;

create or replace function public.referral_is_partner_member(
  p_organization_id text,
  p_partner_id uuid,
  p_roles text[] default null
) returns boolean
language sql stable security definer set search_path=public,pg_temp
as $$
  select exists(
    select 1 from public.referral_partner_memberships m
    where m.organization_id=p_organization_id
      and m.partner_id=p_partner_id
      and m.user_id=auth.uid()
      and m.active
      and (p_roles is null or m.role=any(p_roles))
  );
$$;
revoke all on function public.referral_is_partner_member(text,uuid,text[]) from public,anon;
grant execute on function public.referral_is_partner_member(text,uuid,text[]) to authenticated;

alter table public.referral_partner_memberships enable row level security;
revoke all on table public.referral_partner_memberships from public,anon,authenticated;
grant select on table public.referral_partner_memberships to authenticated;
grant all on table public.referral_partner_memberships to service_role;

create policy referral_partner_memberships_internal_read
on public.referral_partner_memberships for select to authenticated
using (public.referral_is_member(organization_id, array['owner','admin','operator']));
create policy referral_partner_memberships_partner_admin_read
on public.referral_partner_memberships for select to authenticated
using (public.referral_is_partner_member(organization_id, partner_id, array['partner_admin']));
create policy referral_partner_memberships_self_read
on public.referral_partner_memberships for select to authenticated
using (user_id=auth.uid() and active);

-- Membership administration is controlled by this function, never a browser
-- table write. A partner admin is scoped to exactly its own partner.
create or replace function public.manage_referral_partner_member(
  p_organization_id text,
  p_partner_id uuid,
  p_user_id uuid,
  p_role text,
  p_active boolean default true
) returns public.referral_partner_memberships
language plpgsql security definer set search_path=public,pg_temp
as $$
declare result public.referral_partner_memberships%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_role not in ('partner_admin','partner_agent') then raise exception 'invalid_partner_role' using errcode='22023'; end if;
  if not public.referral_is_partner_member(p_organization_id,p_partner_id,array['partner_admin']) then
    raise exception 'partner_membership_admin_denied' using errcode='42501';
  end if;
  insert into public.referral_partner_memberships(organization_id,partner_id,user_id,role,active,updated_at)
  values(p_organization_id,p_partner_id,p_user_id,p_role,p_active,now())
  on conflict(organization_id,partner_id,user_id) do update
    set role=excluded.role,active=excluded.active,updated_at=now()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.manage_referral_partner_member(text,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.manage_referral_partner_member(text,uuid,uuid,text,boolean) to authenticated;

-- Operational records are read-only to authenticated clients. Their direct
-- organization_id filter is defense in depth; these policies are the boundary.
do $$
declare policy_name text;
begin
  foreach policy_name in array array[
    'referral_requests_member_read','referral_assignments_member_read',
    'referral_contacts_member_read','referral_rules_member_read',
    'referral_notifications_member_read','referral_events_member_read',
    'referral_exceptions_member_read','referral_conversations_member_read',
    'referral_notes_member_read'
  ] loop
    execute format('drop policy if exists %I on public.%I', policy_name,
      case policy_name
        when 'referral_requests_member_read' then 'referral_service_requests'
        when 'referral_assignments_member_read' then 'referral_assignments'
        when 'referral_contacts_member_read' then 'referral_partner_contacts'
        when 'referral_rules_member_read' then 'referral_partner_service_rules'
        when 'referral_notifications_member_read' then 'referral_notification_attempts'
        when 'referral_events_member_read' then 'referral_operational_events'
        when 'referral_exceptions_member_read' then 'referral_operational_exceptions'
        when 'referral_conversations_member_read' then 'referral_conversation_operations'
        else 'referral_internal_notes'
      end);
  end loop;
end $$;

create policy referral_requests_internal_read on public.referral_service_requests for select to authenticated
using (public.referral_is_member(organization_id,array['owner','admin','operator']));
create policy referral_requests_partner_assigned_read on public.referral_service_requests for select to authenticated
using (exists(select 1 from public.referral_assignments a where a.request_id=referral_service_requests.id and a.organization_id=referral_service_requests.organization_id and public.referral_is_partner_member(a.organization_id,a.partner_id,array['partner_admin','partner_agent'])));
create policy referral_assignments_internal_read on public.referral_assignments for select to authenticated
using (public.referral_is_member(organization_id,array['owner','admin','operator']));
create policy referral_assignments_partner_read on public.referral_assignments for select to authenticated
using (public.referral_is_partner_member(organization_id,partner_id,array['partner_admin','partner_agent']));
create policy referral_contacts_internal_read on public.referral_partner_contacts for select to authenticated
using (public.referral_is_member(organization_id,array['owner','admin','operator']));
create policy referral_contacts_partner_read on public.referral_partner_contacts for select to authenticated
using (public.referral_is_partner_member(organization_id,partner_id,array['partner_admin','partner_agent']));
create policy referral_rules_internal_read on public.referral_partner_service_rules for select to authenticated
using (public.referral_is_member(organization_id,array['owner','admin','operator']));
create policy referral_rules_partner_read on public.referral_partner_service_rules for select to authenticated
using (public.referral_is_partner_member(organization_id,partner_id,array['partner_admin']));
create policy referral_notifications_internal_read on public.referral_notification_attempts for select to authenticated
using (public.referral_is_member(organization_id,array['owner','admin','operator']));
create policy referral_events_internal_read on public.referral_operational_events for select to authenticated
using (public.referral_is_member(organization_id,array['owner','admin','operator']));
create policy referral_events_partner_assignment_read on public.referral_operational_events for select to authenticated
using (aggregate_type='assignment' and exists(select 1 from public.referral_assignments a where a.id=aggregate_id and a.organization_id=referral_operational_events.organization_id and public.referral_is_partner_member(a.organization_id,a.partner_id,array['partner_admin','partner_agent'])));
create policy referral_exceptions_internal_read on public.referral_operational_exceptions for select to authenticated
using (public.referral_is_member(organization_id,array['owner','admin','operator']));
create policy referral_conversations_internal_read on public.referral_conversation_operations for select to authenticated
using (public.referral_is_member(organization_id,array['owner','admin','operator']));
create policy referral_notes_internal_read on public.referral_internal_notes for select to authenticated
using (public.referral_is_member(organization_id,array['owner','admin','operator']));

-- Prevent application roles, including service_role, from mutating audit rows
-- after insert. Database owners remain outside the application threat model.
create or replace function public.referral_reject_operational_event_mutation()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$ begin
  raise exception 'referral_operational_events_are_immutable' using errcode='42501';
end $$;
revoke all on function public.referral_reject_operational_event_mutation() from public,anon,authenticated;
drop trigger if exists referral_operational_events_immutable on public.referral_operational_events;
create trigger referral_operational_events_immutable
before update or delete on public.referral_operational_events
for each row execute function public.referral_reject_operational_event_mutation();

create or replace function public.append_referral_operational_event(
  p_organization_id text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
) returns public.referral_operational_events
language plpgsql security definer set search_path=public,pg_temp
as $$
declare result public.referral_operational_events%rowtype;
begin
  if auth.uid() is null or not public.referral_is_member(p_organization_id,array['owner','admin','operator']) then
    raise exception 'referral_event_append_denied' using errcode='42501';
  end if;
  if nullif(trim(p_aggregate_type),'') is null or nullif(trim(p_event_type),'') is null
    or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) <> 'object' then
    raise exception 'referral_event_invalid' using errcode='22023';
  end if;
  insert into public.referral_operational_events(
    organization_id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,
    source,metadata,idempotency_key
  ) values (
    p_organization_id,p_aggregate_type,p_aggregate_id,p_event_type,'user',auth.uid(),
    'append_referral_operational_event',p_metadata,p_idempotency_key
  ) on conflict(organization_id,idempotency_key) where idempotency_key is not null
    do nothing
  returning * into result;
  if not found and p_idempotency_key is not null then
    select * into result from public.referral_operational_events
      where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  end if;
  return result;
end;
$$;
revoke all on function public.append_referral_operational_event(text,text,uuid,text,jsonb,text) from public,anon;
grant execute on function public.append_referral_operational_event(text,text,uuid,text,jsonb,text) to authenticated;

-- Replaces the prior capture function without changing the worker's RPC
-- contract. A delivery replay returns its original request even if closed;
-- a new delivery after closure starts the next explicit case_cycle.
create or replace function public.capture_immigration_flow_request(
  p_organization_id text,p_lead_id uuid,p_channel_user_id text,p_completion_key text,
  p_delivery_key text,p_completed_at timestamptz,p_intake jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare lead_row public.leads%rowtype; request_row public.referral_service_requests%rowtype;
  replay_request_id uuid; next_cycle integer; request_created boolean:=false; event_type text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_organization_id <> 'luis-gabriel-referral-hub' then raise exception 'referral_immigration_capture_tenant_forbidden' using errcode='42501'; end if;
  if nullif(trim(p_channel_user_id),'') is null or nullif(trim(p_completion_key),'') is null or nullif(trim(p_delivery_key),'') is null or p_completed_at is null
    or jsonb_typeof(coalesce(p_intake,'{}'::jsonb)) <> 'object' or p_intake->>'intake_type' <> 'IMMIGRATION'
    or nullif(trim(p_intake->>'topic'),'') is null or nullif(trim(p_intake->>'description'),'') is null then raise exception 'referral_immigration_capture_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id||':'||p_lead_id::text||':luis_inmigracion',0));
  select * into lead_row from public.leads where id=p_lead_id and organization_id=p_organization_id for update;
  if not found then raise exception 'referral_lead_not_found' using errcode='P0002'; end if;
  if coalesce(to_jsonb(lead_row)->>'channel','') <> 'whatsapp' or coalesce(to_jsonb(lead_row)->>'channel_user_id','') <> p_channel_user_id then raise exception 'referral_conversation_identity_mismatch' using errcode='42501'; end if;
  select aggregate_id into replay_request_id from public.referral_operational_events
    where organization_id=p_organization_id and idempotency_key='immigration-flow:'||p_delivery_key and aggregate_type='request' limit 1;
  if replay_request_id is not null then
    select * into request_row from public.referral_service_requests where id=replay_request_id and organization_id=p_organization_id;
    if found then return jsonb_build_object('success',true,'request_id',request_row.id,'request_status',request_row.status,'created',false,'assigned',false,'notification_created',false,'idempotent_replay',true,'case_cycle',request_row.case_cycle); end if;
  end if;
  select * into request_row from public.referral_service_requests where organization_id=p_organization_id and lead_id=p_lead_id and service_id='luis_inmigracion' and status in ('new','collecting','prequalified','qualified') order by created_at desc limit 1 for update;
  if found then
    update public.referral_service_requests set source_channel='whatsapp',postal_code=nullif(trim(p_intake->>'postal_code'),''),language=nullif(trim(p_intake->>'language'),''),intake=p_intake,intake_complete=true,consent=jsonb_build_object('status',case p_intake->>'sharing_consent' when 'AUTHORIZED' then 'authorized' when 'DECLINED' then 'declined' else 'pending_review' end,'captured',p_intake->>'sharing_consent' in ('AUTHORIZED','DECLINED'),'captured_at',case when p_intake->>'sharing_consent' in ('AUTHORIZED','DECLINED') then now() else null end,'version',nullif(trim(p_intake->>'consent_version'),''),'source',nullif(trim(p_intake->>'consent_source'),'')),status='prequalified',updated_at=now() where id=request_row.id returning * into request_row;
    event_type:='immigration_flow_request_updated';
  else
    select coalesce(max(case_cycle),0)+1 into next_cycle from public.referral_service_requests where organization_id=p_organization_id and lead_id=p_lead_id and service_id='luis_inmigracion';
    insert into public.referral_service_requests(organization_id,lead_id,service_id,source_channel,postal_code,language,intake,intake_complete,consent,status,completion_key,case_cycle)
    values(p_organization_id,p_lead_id,'luis_inmigracion','whatsapp',nullif(trim(p_intake->>'postal_code'),''),nullif(trim(p_intake->>'language'),''),p_intake,true,jsonb_build_object('status',case p_intake->>'sharing_consent' when 'AUTHORIZED' then 'authorized' when 'DECLINED' then 'declined' else 'pending_review' end,'captured',p_intake->>'sharing_consent' in ('AUTHORIZED','DECLINED'),'captured_at',case when p_intake->>'sharing_consent' in ('AUTHORIZED','DECLINED') then now() else null end,'version',nullif(trim(p_intake->>'consent_version'),''),'source',nullif(trim(p_intake->>'consent_source'),'')),'prequalified',p_completion_key,next_cycle) returning * into request_row;
    request_created:=true; event_type:='immigration_flow_request_created';
  end if;
  insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,source,new_state,metadata,idempotency_key)
  values(p_organization_id,'request',request_row.id,event_type,'service_role','capture_immigration_flow_request',jsonb_build_object('status',request_row.status,'intake_complete',request_row.intake_complete,'case_cycle',request_row.case_cycle),jsonb_build_object('flow_type','luis_unified_services','flow_version','v1','completed_at',p_completed_at),'immigration-flow:'||p_delivery_key);
  return jsonb_build_object('success',true,'request_id',request_row.id,'request_status',request_row.status,'created',request_created,'assigned',false,'notification_created',false,'idempotent_replay',false,'case_cycle',request_row.case_cycle);
end $$;
revoke all on function public.capture_immigration_flow_request(text,uuid,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.capture_immigration_flow_request(text,uuid,text,text,text,timestamptz,jsonb) to service_role;

commit;
