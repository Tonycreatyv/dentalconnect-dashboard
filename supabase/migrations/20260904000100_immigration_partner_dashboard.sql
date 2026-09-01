-- Authenticated partner access for the Luis Immigration operational circuit.
-- This is additive to the materialized operational baseline and 20260903000100.
begin;

do $$
begin
  if to_regclass('public.referral_partners') is null
    or to_regclass('public.referral_partner_service_rules') is null
    or to_regclass('public.referral_assignments') is null
    or to_regclass('public.referral_service_requests') is null
    or to_regclass('public.referral_operational_events') is null
    or to_regclass('public.referral_operational_exceptions') is null then
    raise exception 'immigration_partner_dashboard_operational_baseline_missing';
  end if;
  if to_regprocedure('public.capture_immigration_flow_request(text,uuid,text,text,text,timestamptz,jsonb)') is null then
    raise exception 'immigration_partner_dashboard_capture_rpc_missing';
  end if;
end $$;

create table public.referral_partner_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  partner_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('partner_admin','partner_agent')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, partner_id, user_id),
  foreign key (organization_id, partner_id)
    references public.referral_partners(organization_id, id) on delete cascade
);
create index referral_partner_memberships_user_active_idx
  on public.referral_partner_memberships(user_id, active, organization_id, partner_id);

create or replace function public.referral_is_active_partner_member(
  p_organization_id text, p_partner_id uuid, p_roles text[] default null
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from public.referral_partner_memberships m
    where m.organization_id=p_organization_id and m.partner_id=p_partner_id
      and m.user_id=auth.uid() and m.active
      and (p_roles is null or m.role=any(p_roles))
  );
$$;
revoke all on function public.referral_is_active_partner_member(text,uuid,text[]) from public, anon;
grant execute on function public.referral_is_active_partner_member(text,uuid,text[]) to authenticated;

alter table public.referral_partner_memberships enable row level security;
revoke all on public.referral_partner_memberships from public, anon, authenticated;
grant select on public.referral_partner_memberships to authenticated;
grant all on public.referral_partner_memberships to service_role;
create policy referral_partner_memberships_self_read on public.referral_partner_memberships
  for select to authenticated using (user_id=auth.uid() and active);

-- Partner reads are derived from auth.uid() membership and assignment, never
-- browser-supplied tenant or partner identifiers.
create policy referral_assignments_partner_read on public.referral_assignments
  for select to authenticated using (
    public.referral_is_active_partner_member(organization_id, partner_id)
  );
create policy referral_requests_partner_authorized_read on public.referral_service_requests
  for select to authenticated using (
    service_id='luis_inmigracion'
    and coalesce(consent->>'status','pending_review')='authorized'
    and exists (
      select 1 from public.referral_assignments a
      where a.request_id=referral_service_requests.id and a.organization_id=referral_service_requests.organization_id
        and public.referral_is_active_partner_member(a.organization_id,a.partner_id)
    )
  );
create policy referral_events_partner_assignment_read on public.referral_operational_events
  for select to authenticated using (
    aggregate_type='assignment' and exists (
      select 1 from public.referral_assignments a
      where a.id=aggregate_id and a.organization_id=referral_operational_events.organization_id
        and public.referral_is_active_partner_member(a.organization_id,a.partner_id)
    )
  );

-- Only service_role invokes this after a successful AUTHORIZED capture. It
-- deliberately creates neither notification nor access token.
create or replace function public.auto_assign_immigration_partner(p_request_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.referral_service_requests%rowtype; rule public.referral_partner_service_rules%rowtype;
  assignment public.referral_assignments%rowtype; next_attempt integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select * into r from public.referral_service_requests where id=p_request_id for update;
  if not found then raise exception 'immigration_request_not_found' using errcode='P0002'; end if;
  if r.service_id<>'luis_inmigracion' or coalesce(r.consent->>'status','pending_review')<>'authorized' then
    return jsonb_build_object('assigned',false,'reason','consent_or_service_not_eligible');
  end if;
  select * into assignment from public.referral_assignments where organization_id=r.organization_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('assigned',true,'assignment_id',assignment.id,'idempotent_replay',true); end if;
  select * into assignment from public.referral_assignments where request_id=r.id and status in ('pending_assignment','assigned','accepted') order by created_at desc limit 1;
  if found then return jsonb_build_object('assigned',true,'assignment_id',assignment.id,'idempotent_replay',true); end if;
  select x.* into rule from public.referral_partner_service_rules x join public.referral_partners p on p.id=x.partner_id and p.organization_id=x.organization_id
   where x.organization_id=r.organization_id and x.service_id='luis_inmigracion' and x.active and p.active and p.partnership_status='active'
   order by x.assignment_priority,x.id for update of x skip locked limit 1;
  if not found then
    insert into public.referral_operational_exceptions(organization_id,aggregate_type,aggregate_id,exception_type,severity,summary,details)
    values(r.organization_id,'request',r.id,'immigration_partner_unconfigured','high','No hay aliado activo configurado para Inmigración',jsonb_build_object('service_id',r.service_id));
    insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,source,metadata,idempotency_key)
    values(r.organization_id,'request',r.id,'immigration_assignment_unavailable','service_role','auto_assign_immigration_partner','{}'::jsonb,p_idempotency_key||':exception');
    return jsonb_build_object('assigned',false,'reason','no_active_partner');
  end if;
  select coalesce(max(attempt_number),0)+1 into next_attempt from public.referral_assignments where request_id=r.id;
  insert into public.referral_assignments(organization_id,request_id,partner_id,assignment_mode,assignment_rule,assignment_reason,attempt_number,idempotency_key,assigned_by_type,status,work_status)
  values(r.organization_id,r.id,rule.partner_id,'automatic','immigration_authorized_partner',jsonb_build_object('service_id','luis_inmigracion'),next_attempt,p_idempotency_key,'system','assigned','new') returning * into assignment;
  insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,source,new_state,metadata,idempotency_key)
  values(r.organization_id,'assignment',assignment.id,'immigration_assignment_created','service_role','auto_assign_immigration_partner',to_jsonb(assignment),jsonb_build_object('request_id',r.id),p_idempotency_key||':event');
  return jsonb_build_object('assigned',true,'assignment_id',assignment.id,'idempotent_replay',false);
end $$;

create or replace function public.partner_update_immigration_assignment(
  p_assignment_id uuid, p_action text, p_note text default null, p_appointment_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.referral_assignments%rowtype; before_state jsonb; event_name text; next_status text; next_work_status text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_action not in ('accept','reject','contacted','no_answer','appointment_scheduled','converted','closed_not_converted','note') then raise exception 'invalid_partner_action' using errcode='22023'; end if;
  select * into a from public.referral_assignments where id=p_assignment_id for update;
  if not found or not public.referral_is_active_partner_member(a.organization_id,a.partner_id) then raise exception 'partner_assignment_access_denied' using errcode='42501'; end if;
  if not exists(select 1 from public.referral_service_requests r where r.id=a.request_id and r.service_id='luis_inmigracion' and coalesce(r.consent->>'status','')='authorized') then raise exception 'partner_assignment_not_authorized_immigration' using errcode='42501'; end if;
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
revoke all on function public.auto_assign_immigration_partner(uuid,text) from public,anon,authenticated;
grant execute on function public.auto_assign_immigration_partner(uuid,text) to service_role;
revoke all on function public.partner_update_immigration_assignment(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.partner_update_immigration_assignment(uuid,text,text,timestamptz) to authenticated;
commit;
