-- Reconstructed from the live production schema on 2026-10-02.
-- This migration version is already present in production history.
-- It exists in Git so a clean environment can reproduce the current lifecycle core.

alter table public.referral_assignments
  add column if not exists follow_up_reason text,
  add column if not exists next_followup_at timestamptz,
  add column if not exists follow_up_attempt_count integer not null default 0;

alter table public.referral_assignments
  drop constraint if exists referral_assignments_work_status_check;
alter table public.referral_assignments
  add constraint referral_assignments_work_status_check
  check (work_status in ('new','contacted','appointment_scheduled','in_progress','converted','not_converted','closed','follow_up'));

alter table public.referral_assignments
  drop constraint if exists referral_assignments_follow_up_reason_check;
alter table public.referral_assignments
  add constraint referral_assignments_follow_up_reason_check
  check (
    follow_up_reason is null
    or follow_up_reason in ('no_answer','missing_police_report','missing_document','missing_information','other')
  );

CREATE OR REPLACE FUNCTION public.apply_partner_assignment_transition(p_assignment_id uuid, p_action text, p_note text DEFAULT NULL::text, p_appointment_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_follow_up_reason text DEFAULT NULL::text, p_next_followup_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_correction_reason text DEFAULT NULL::text, p_actor_type text DEFAULT 'partner'::text, p_actor_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'partner_update_referral_assignment'::text, p_actor_metadata jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a public.referral_assignments%rowtype; r public.referral_service_requests%rowtype;
  before_state jsonb; action text:=lower(trim(p_action)); terminal boolean;
begin
  select * into a from public.referral_assignments where id=p_assignment_id for update;
  if not found then raise exception 'referral_assignment_not_found' using errcode='P0002'; end if;
  select * into r from public.referral_service_requests where id=a.request_id and organization_id=a.organization_id for update;
  if not found then raise exception 'referral_request_not_found' using errcode='P0002'; end if;
  if p_idempotency_key is not null and exists (
    select 1 from public.referral_operational_events e
    where e.organization_id=a.organization_id and e.idempotency_key=p_idempotency_key
  ) then
    return jsonb_build_object('assignment_id',a.id,'status',a.status,'work_status',a.work_status,
      'follow_up_reason',a.follow_up_reason,'next_followup_at',a.next_followup_at,
      'follow_up_attempt_count',a.follow_up_attempt_count,'request_status',r.status);
  end if;
  if action not in ('accept','reject','contacted','no_answer','appointment_scheduled','converted','closed_not_converted','note','follow_up','correct_result') then
    raise exception 'invalid_partner_action' using errcode='22023';
  end if;
  if p_actor_type not in ('system','service_role','user','partner','provider') then raise exception 'invalid_event_actor_type' using errcode='22023'; end if;
  before_state:=to_jsonb(a); terminal:=a.work_status in ('converted','not_converted');
  if action='accept' then
    if a.status<>'assigned' then raise exception 'invalid_assignment_transition' using errcode='22023'; end if;
    update public.referral_assignments set status='accepted',accepted_at=now(),updated_at=now() where id=a.id returning * into a;
  elsif action='reject' then
    if a.status not in ('assigned','accepted') or nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'invalid_assignment_rejection' using errcode='22023'; end if;
    update public.referral_assignments set status='rejected',rejected_at=now(),rejection_reason=trim(p_note),updated_at=now() where id=a.id returning * into a;
  elsif action in ('contacted','no_answer','appointment_scheduled','converted','closed_not_converted','follow_up') then
    if a.status<>'accepted' then raise exception 'assignment_must_be_accepted' using errcode='22023'; end if;
    if terminal then raise exception 'terminal_assignment_requires_correction' using errcode='22023'; end if;
    if action='contacted' then update public.referral_assignments set work_status='contacted',updated_at=now() where id=a.id returning * into a;
    elsif action='no_answer' then update public.referral_assignments set updated_at=now() where id=a.id returning * into a;
    elsif action='appointment_scheduled' then update public.referral_assignments set work_status='appointment_scheduled',updated_at=now() where id=a.id returning * into a;
    elsif action='converted' then
      update public.referral_assignments set work_status='converted',next_followup_at=null,updated_at=now() where id=a.id returning * into a;
      update public.referral_service_requests set status='closed',updated_at=now() where id=r.id returning * into r;
    elsif action='closed_not_converted' then
      update public.referral_assignments set work_status='not_converted',next_followup_at=null,updated_at=now() where id=a.id returning * into a;
      update public.referral_service_requests set status='closed',updated_at=now() where id=r.id returning * into r;
    else
      if p_follow_up_reason not in ('no_answer','missing_police_report','missing_document','missing_information','other') then raise exception 'invalid_follow_up_reason' using errcode='22023'; end if;
      update public.referral_assignments set work_status='follow_up',follow_up_reason=p_follow_up_reason,next_followup_at=p_next_followup_at,follow_up_attempt_count=follow_up_attempt_count+1,updated_at=now() where id=a.id returning * into a;
    end if;
  elsif action='correct_result' then
    if a.status<>'accepted' or a.work_status not in ('converted','not_converted') then raise exception 'invalid_result_correction' using errcode='22023'; end if;
    if p_correction_reason not in ('marked_by_mistake','new_information','other') or (p_correction_reason='other' and nullif(trim(coalesce(p_note,'')),'') is null) then raise exception 'invalid_result_correction' using errcode='22023'; end if;
    update public.referral_assignments set work_status='follow_up',follow_up_reason=null,next_followup_at=null,updated_at=now() where id=a.id returning * into a;
    update public.referral_service_requests set status='prequalified',updated_at=now() where id=r.id returning * into r;
  else
    update public.referral_assignments set updated_at=now() where id=a.id returning * into a;
  end if;
  insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,source,previous_state,new_state,metadata,idempotency_key)
  values(a.organization_id,'assignment',a.id,'partner_'||action,p_actor_type,p_actor_id,p_source,before_state,to_jsonb(a),jsonb_build_object('note',nullif(trim(coalesce(p_note,'')),''),'appointment_at',p_appointment_at,'follow_up_reason',p_follow_up_reason,'next_followup_at',p_next_followup_at,'correction_reason',p_correction_reason,'request_id',r.id,'request_status_after',r.status,'actor_metadata',coalesce(p_actor_metadata,'{}'::jsonb)),p_idempotency_key);
  return jsonb_build_object('assignment_id',a.id,'status',a.status,'work_status',a.work_status,
    'follow_up_reason',a.follow_up_reason,'next_followup_at',a.next_followup_at,
    'follow_up_attempt_count',a.follow_up_attempt_count,'request_status',r.status);
end $function$
;

revoke all on function public.apply_partner_assignment_transition(
  uuid,text,text,timestamptz,text,timestamptz,text,text,uuid,text,jsonb,text
) from public, anon, authenticated;
grant execute on function public.apply_partner_assignment_transition(
  uuid,text,text,timestamptz,text,timestamptz,text,text,uuid,text,jsonb,text
) to service_role;
