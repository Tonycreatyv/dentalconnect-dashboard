-- ConeXXion V2: canonical admin case mutations.
-- Repository-only hardening migration. Do not apply until the local P0 UI branch
-- has been reconciled and the migration is reviewed against production.

create or replace function public.admin_update_referral_assignment(
  p_request_id uuid,
  p_action text,
  p_note text default null,
  p_appointment_at timestamptz default null,
  p_follow_up_reason text default null,
  p_next_followup_at timestamptz default null,
  p_correction_reason text default null,
  p_operation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  r public.referral_service_requests%rowtype;
  a public.referral_assignments%rowtype;
  operation_id uuid := coalesce(p_operation_id, gen_random_uuid());
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  select *
    into r
  from public.referral_service_requests
  where id = p_request_id;

  if not found then
    raise exception 'referral_request_not_found' using errcode='P0002';
  end if;

  if not public.referral_is_member(r.organization_id, array['owner','admin']) then
    raise exception 'referral_access_denied' using errcode='42501';
  end if;

  select *
    into a
  from public.referral_assignments
  where request_id = r.id
    and status in ('pending_assignment','assigned','accepted')
  order by attempt_number desc
  limit 1
  for update;

  if not found then
    raise exception 'active_assignment_not_found' using errcode='P0002';
  end if;

  return public.apply_partner_assignment_transition(
    a.id,
    p_action,
    p_note,
    p_appointment_at,
    p_follow_up_reason,
    p_next_followup_at,
    p_correction_reason,
    'user',
    auth.uid(),
    'admin_update_referral_assignment',
    jsonb_build_object('request_id', r.id, 'admin_user_id', auth.uid()),
    'admin-auth:' || a.id || ':' || operation_id
  );
end
$function$;

revoke all on function public.admin_update_referral_assignment(
  uuid,text,text,timestamptz,text,timestamptz,text,uuid
) from public, anon;
grant execute on function public.admin_update_referral_assignment(
  uuid,text,text,timestamptz,text,timestamptz,text,uuid
) to authenticated, service_role;


create or replace function public.admin_reassign_referral_request(
  p_request_id uuid,
  p_partner_id uuid,
  p_partner_contact_id uuid default null,
  p_reason text default null,
  p_operation_id uuid default null
)
returns public.referral_assignments
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  r public.referral_service_requests%rowtype;
  previous_assignment public.referral_assignments%rowtype;
  replacement public.referral_assignments%rowtype;
  operation_id uuid := coalesce(p_operation_id, gen_random_uuid());
  idempotency_key text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  select *
    into r
  from public.referral_service_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'referral_request_not_found' using errcode='P0002';
  end if;

  if not public.referral_is_member(r.organization_id, array['owner','admin']) then
    raise exception 'referral_access_denied' using errcode='42501';
  end if;

  if p_partner_id is null then
    raise exception 'partner_required' using errcode='22023';
  end if;

  if not exists (
    select 1
    from public.referral_partners p
    where p.id = p_partner_id
      and p.organization_id = r.organization_id
      and coalesce((to_jsonb(p)->>'active')::boolean, true)
  ) then
    raise exception 'partner_not_available' using errcode='22023';
  end if;

  select *
    into previous_assignment
  from public.referral_assignments
  where request_id = r.id
    and status in ('pending_assignment','assigned','accepted')
  order by attempt_number desc
  limit 1
  for update;

  if found and previous_assignment.partner_id = p_partner_id then
    return previous_assignment;
  end if;

  if found then
    update public.referral_assignments
       set status = 'reassigned',
           updated_at = now()
     where id = previous_assignment.id;
  end if;

  idempotency_key := 'admin-reassign:' || r.id || ':' || operation_id;

  replacement := public.assign_referral_request(
    r.organization_id,
    r.id,
    idempotency_key,
    'manual',
    p_partner_id,
    p_partner_contact_id
  );

  if replacement.id is null then
    raise exception 'replacement_assignment_not_created' using errcode='P0001';
  end if;

  if previous_assignment.id is not null then
    update public.referral_assignments
       set superseded_by_assignment_id = replacement.id,
           updated_at = now()
     where id = previous_assignment.id;

    insert into public.referral_operational_events(
      organization_id,
      aggregate_type,
      aggregate_id,
      event_type,
      actor_type,
      actor_id,
      source,
      previous_state,
      new_state,
      metadata,
      idempotency_key
    )
    values (
      r.organization_id,
      'assignment',
      previous_assignment.id,
      'assignment_reassigned',
      'user',
      auth.uid(),
      'admin_reassign_referral_request',
      to_jsonb(previous_assignment),
      (
        select to_jsonb(a)
        from public.referral_assignments a
        where a.id = previous_assignment.id
      ),
      jsonb_build_object(
        'request_id', r.id,
        'replacement_assignment_id', replacement.id,
        'replacement_partner_id', replacement.partner_id,
        'reason', nullif(trim(coalesce(p_reason,'')), '')
      ),
      idempotency_key || ':previous'
    );
  end if;

  return replacement;
end
$function$;

revoke all on function public.admin_reassign_referral_request(
  uuid,uuid,uuid,text,uuid
) from public, anon;
grant execute on function public.admin_reassign_referral_request(
  uuid,uuid,uuid,text,uuid
) to authenticated, service_role;
