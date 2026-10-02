-- Closes a real lifecycle gap: partner_update_immigration_assignment could
-- move an assignment to a terminal work_status (converted/not_converted)
-- while its parent referral_service_requests row stayed in an active status
-- (e.g. prequalified) forever, which let a completed historical case keep
-- blocking a brand-new case for the same lead+service (the active-request
-- guard in capture_legal_flow_request/capture_immigration_flow_request only
-- looks at request.status, not the assignment). This migration does not
-- change the signature, add a table, or touch existing rows — it only
-- extends the one transactional RPC that already owns every assignment
-- write so the parent request's status is kept in sync in the same
-- transaction. Same-signature CREATE OR REPLACE — no drop needed.
begin;

do $$
begin
  if to_regprocedure('public.partner_update_immigration_assignment(uuid,text,text,timestamptz,text,timestamptz,text)') is null then
    raise exception 'partner_assignment_request_lifecycle_sync_baseline_missing';
  end if;
end $$;

create or replace function public.partner_update_immigration_assignment(
  p_assignment_id uuid,
  p_action text,
  p_note text default null,
  p_appointment_at timestamptz default null,
  p_follow_up_reason text default null,
  p_next_followup_at timestamptz default null,
  p_correction_reason text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  a public.referral_assignments%rowtype;
  before_state jsonb;
  event_name text;
  next_status text;
  next_work_status text;
  next_request_status text;
  request_status_after text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_action not in ('accept','reject','contacted','no_answer','appointment_scheduled','converted','closed_not_converted','note','follow_up','correct_result') then
    raise exception 'invalid_partner_action' using errcode='22023';
  end if;
  select * into a from public.referral_assignments where id=p_assignment_id for update;
  if not found or not public.referral_is_active_partner_member(a.organization_id,a.partner_id) then
    raise exception 'partner_assignment_access_denied' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.referral_service_requests r
    where r.id=a.request_id and r.service_id in ('luis_inmigracion','luis_accidente')
      and coalesce(r.consent->>'status','')='authorized'
  ) then raise exception 'partner_assignment_not_authorized_immigration' using errcode='42501'; end if;

  before_state:=to_jsonb(a);
  next_status:=a.status;
  next_work_status:=a.work_status;
  next_request_status:=null;
  if p_action='accept' then
    if a.status<>'assigned' then raise exception 'invalid_assignment_transition'; end if;
    next_status:='accepted';
  elsif p_action='reject' then
    if a.status not in ('assigned','accepted') or nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'invalid_assignment_rejection'; end if;
    next_status:='rejected';
  elsif p_action in ('contacted','no_answer','appointment_scheduled','converted','closed_not_converted') then
    if a.status<>'accepted' then raise exception 'assignment_must_be_accepted'; end if;
    -- A terminal assignment may only be reopened through the explicit,
    -- audited 'correct_result' action below — not silently overwritten by a
    -- second contact/result action. Without this, calling e.g. 'converted'
    -- twice (or 'converted' then 'closed_not_converted') would flip
    -- work_status and desynchronize the request lifecycle without any audit
    -- trail of the correction.
    if a.work_status in ('converted','not_converted') then raise exception 'assignment_already_closed'; end if;
    next_work_status:=case p_action when 'closed_not_converted' then 'not_converted' when 'no_answer' then a.work_status else p_action end;
    if p_action in ('converted','closed_not_converted') then
      next_request_status:='closed';
    end if;
  elsif p_action='follow_up' then
    if a.status<>'accepted' then raise exception 'assignment_must_be_accepted'; end if;
    if a.work_status in ('converted','not_converted') then raise exception 'assignment_already_closed'; end if;
    if p_follow_up_reason is null or p_follow_up_reason not in ('no_answer','missing_police_report','missing_document','missing_information','other') then
      raise exception 'invalid_follow_up_reason' using errcode='22023';
    end if;
    next_work_status:='follow_up';
  elsif p_action='correct_result' then
    if a.status<>'accepted' or a.work_status not in ('converted','not_converted') then
      raise exception 'invalid_final_result_correction' using errcode='22023';
    end if;
    if p_correction_reason is null or p_correction_reason not in ('marked_by_mistake','new_information','other') then
      raise exception 'invalid_correction_reason' using errcode='22023';
    end if;
    -- marked_by_mistake/new_information are self-explanatory — only 'other'
    -- carries no information of its own, so it's the one reason that must
    -- not be submitted with a blank note.
    if p_correction_reason = 'other' and nullif(trim(coalesce(p_note,'')),'') is null then
      raise exception 'correction_note_required' using errcode='22023';
    end if;
    next_work_status:='follow_up';
    next_request_status:='prequalified';
  end if;

  update public.referral_assignments set
    status=next_status,
    work_status=next_work_status,
    accepted_at=case when p_action='accept' then now() else accepted_at end,
    rejected_at=case when p_action='reject' then now() else rejected_at end,
    rejection_reason=case when p_action='reject' then trim(p_note) else rejection_reason end,
    follow_up_reason=case
      when p_action='follow_up' then p_follow_up_reason
      when p_action='correct_result' then null
      else follow_up_reason
    end,
    next_followup_at=case
      when p_action='follow_up' then p_next_followup_at
      when p_action='correct_result' then null
      else next_followup_at
    end,
    follow_up_attempt_count=case when p_action='follow_up' then follow_up_attempt_count+1 else follow_up_attempt_count end,
    updated_at=now()
  where id=a.id returning * into a;

  -- Same transaction as the assignment write above, guarded so this is a
  -- no-op unless the request is actually in the state being transitioned
  -- out of — closing never touches an already-closed request, reopening
  -- never touches a request some other path left in a different status.
  -- Historical rows whose assignment was never re-touched are untouched.
  if next_request_status='closed' then
    update public.referral_service_requests
    set status='closed', updated_at=now()
    where id=a.request_id and status<>'closed';
  elsif next_request_status='prequalified' then
    update public.referral_service_requests
    set status='prequalified', updated_at=now()
    where id=a.request_id and status='closed';
  end if;
  select status into request_status_after from public.referral_service_requests where id=a.request_id;

  event_name:=case when p_action='correct_result' then 'partner_result_corrected' else 'partner_'||p_action end;
  insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,source,previous_state,new_state,metadata)
  values(
    a.organization_id,'assignment',a.id,event_name,'partner',auth.uid(),'partner_update_immigration_assignment',before_state,to_jsonb(a),
    jsonb_build_object(
      'note',nullif(trim(coalesce(p_note,'')),''),
      'appointment_at',p_appointment_at,
      'follow_up_reason',p_follow_up_reason,
      'next_followup_at',p_next_followup_at,
      'from_work_status',case when p_action='correct_result' then before_state->>'work_status' else null end,
      'to_work_status',case when p_action='correct_result' then 'follow_up' else null end,
      'correction_reason',case when p_action='correct_result' then p_correction_reason else null end,
      'request_id',a.request_id,
      'request_status_after',request_status_after
    )
  );
  return jsonb_build_object('assignment_id',a.id,'status',a.status,'work_status',a.work_status,'follow_up_reason',a.follow_up_reason,'next_followup_at',a.next_followup_at,'follow_up_attempt_count',a.follow_up_attempt_count,'request_status',request_status_after);
end $$;

revoke all on function public.partner_update_immigration_assignment(uuid,text,text,timestamptz,text,timestamptz,text) from public,anon;
grant execute on function public.partner_update_immigration_assignment(uuid,text,text,timestamptz,text,timestamptz,text) to authenticated;

commit;
