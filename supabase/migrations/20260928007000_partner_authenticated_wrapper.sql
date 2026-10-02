-- Reconstructed from the live production schema on 2026-10-02.
CREATE OR REPLACE FUNCTION public.partner_update_referral_assignment(p_assignment_id uuid, p_action text, p_note text DEFAULT NULL::text, p_appointment_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_follow_up_reason text DEFAULT NULL::text, p_next_followup_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_correction_reason text DEFAULT NULL::text, p_operation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare a public.referral_assignments%rowtype; r public.referral_service_requests%rowtype; s public.service_configs%rowtype; operation_id uuid:=coalesce(p_operation_id,gen_random_uuid());
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into a from public.referral_assignments where id=p_assignment_id; if not found or not public.referral_is_active_partner_member(a.organization_id,a.partner_id) then raise exception 'partner_assignment_access_denied' using errcode='42501'; end if;
  select * into r from public.referral_service_requests where id=a.request_id and organization_id=a.organization_id;
  select * into s from public.service_configs where organization_id=a.organization_id and id=r.service_id;
  if not found then raise exception 'partner_service_configuration_missing' using errcode='P0002'; end if;
  if s.requires_authorization is true and coalesce(r.consent->>'status','')<>'authorized' then raise exception 'partner_assignment_not_authorized' using errcode='42501'; end if;
  return public.apply_partner_assignment_transition(p_assignment_id,p_action,p_note,p_appointment_at,p_follow_up_reason,p_next_followup_at,p_correction_reason,'partner',auth.uid(),'partner_update_referral_assignment',jsonb_build_object('partner_id',a.partner_id), 'partner-auth:'||a.id||':'||operation_id);
end $function$
;

revoke all on function public.partner_update_referral_assignment(
  uuid,text,text,timestamptz,text,timestamptz,text,uuid
) from public, anon;
grant execute on function public.partner_update_referral_assignment(
  uuid,text,text,timestamptz,text,timestamptz,text,uuid
) to authenticated, service_role;
