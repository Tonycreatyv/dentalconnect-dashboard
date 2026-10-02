-- Partner Portal V1 follow-up contract: durable follow_up_reason/
-- next_followup_at/follow_up_attempt_count on referral_assignments, plus a
-- real 'follow_up' work_status value and a matching partner_update_
-- immigration_assignment RPC action. Additive only — no existing column,
-- constraint value, action, or grant is removed or renamed.
--
-- Base body re-verified against the LIVE remote definition of
-- partner_update_immigration_assignment immediately before writing this
-- migration (service_id in ('luis_inmigracion','luis_accidente'), error
-- code 'partner_assignment_not_authorized_immigration') — NOT copied from
-- the local-only 20260906000100_split_legal_service_ids.sql, which is not
-- reflected in `supabase migration list --linked` remote state and adds
-- luis_dui/luis_criminal support that is out of scope here. If that
-- migration lands before or after this one, the two CREATE OR REPLACE
-- bodies must be reconciled by hand — do not assume ordering resolves it.
begin;

do $$
begin
  if to_regclass('public.referral_assignments') is null
    or to_regprocedure('public.partner_update_immigration_assignment(uuid,text,text,timestamptz)') is null then
    raise exception 'partner_follow_up_contract_baseline_missing';
  end if;
end $$;

alter table public.referral_assignments
  add column follow_up_reason text null,
  add column next_followup_at timestamptz null,
  add column follow_up_attempt_count integer not null default 0;

alter table public.referral_assignments
  drop constraint referral_assignments_work_status_check;
alter table public.referral_assignments
  add constraint referral_assignments_work_status_check
  check (work_status = any (array[
    'new','contacted','appointment_scheduled','in_progress',
    'converted','not_converted','closed','follow_up'
  ]));

alter table public.referral_assignments
  add constraint referral_assignments_follow_up_reason_check
  check (follow_up_reason is null or follow_up_reason = any (array[
    'no_answer','missing_police_report','missing_document','missing_information','other'
  ]));

-- Postgres identifies functions by name+argument-types, not name alone: a
-- plain CREATE OR REPLACE with two new trailing arguments would create a
-- SECOND overload rather than replace the existing one, and PostgREST would
-- then reject every existing 4-arg call (accept/reject/converted/etc.) as an
-- ambiguous overload. Drop the old signature first so exactly one function
-- remains.
drop function if exists public.partner_update_immigration_assignment(uuid,text,text,timestamptz);

create or replace function public.partner_update_immigration_assignment(
  p_assignment_id uuid,
  p_action text,
  p_note text default null,
  p_appointment_at timestamptz default null,
  p_follow_up_reason text default null,
  p_next_followup_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.referral_assignments%rowtype; before_state jsonb; event_name text; next_status text; next_work_status text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_action not in ('accept','reject','contacted','no_answer','appointment_scheduled','converted','closed_not_converted','note','follow_up') then raise exception 'invalid_partner_action' using errcode='22023'; end if;
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
  elsif p_action='follow_up' then
    if a.status<>'accepted' then raise exception 'assignment_must_be_accepted'; end if;
    if a.work_status in ('converted','not_converted') then raise exception 'assignment_already_closed'; end if;
    if p_follow_up_reason is null or p_follow_up_reason not in ('no_answer','missing_police_report','missing_document','missing_information','other') then
      raise exception 'invalid_follow_up_reason' using errcode='22023';
    end if;
    next_work_status:='follow_up';
  end if;
  update public.referral_assignments set
    status=next_status,
    work_status=next_work_status,
    accepted_at=case when p_action='accept' then now() else accepted_at end,
    rejected_at=case when p_action='reject' then now() else rejected_at end,
    rejection_reason=case when p_action='reject' then trim(p_note) else rejection_reason end,
    follow_up_reason=case when p_action='follow_up' then p_follow_up_reason else follow_up_reason end,
    next_followup_at=case when p_action='follow_up' then p_next_followup_at else next_followup_at end,
    follow_up_attempt_count=case when p_action='follow_up' then follow_up_attempt_count+1 else follow_up_attempt_count end,
    updated_at=now()
  where id=a.id returning * into a;
  event_name:='partner_'||p_action;
  insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,source,previous_state,new_state,metadata)
  values(a.organization_id,'assignment',a.id,event_name,'partner',auth.uid(),'partner_update_immigration_assignment',before_state,to_jsonb(a),jsonb_build_object('note',nullif(trim(coalesce(p_note,'')),''),'appointment_at',p_appointment_at,'follow_up_reason',p_follow_up_reason,'next_followup_at',p_next_followup_at));
  return jsonb_build_object('assignment_id',a.id,'status',a.status,'work_status',a.work_status,'follow_up_reason',a.follow_up_reason,'next_followup_at',a.next_followup_at,'follow_up_attempt_count',a.follow_up_attempt_count);
end $$;

revoke all on function public.partner_update_immigration_assignment(uuid,text,text,timestamptz,text,timestamptz) from public,anon;
grant execute on function public.partner_update_immigration_assignment(uuid,text,text,timestamptz,text,timestamptz) to authenticated;

commit;
