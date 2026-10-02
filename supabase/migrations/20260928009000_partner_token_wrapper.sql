-- Reconstructed from the live production schema on 2026-10-02.
CREATE OR REPLACE FUNCTION public.partner_update_referral_assignment_by_token(p_token text, p_assignment_id uuid, p_action text, p_note text DEFAULT NULL::text, p_appointment_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_follow_up_reason text DEFAULT NULL::text, p_next_followup_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_correction_reason text DEFAULT NULL::text, p_operation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.referral_partner_access_tokens%rowtype; a public.referral_assignments%rowtype; r public.referral_service_requests%rowtype; s public.service_configs%rowtype; operation_id uuid:=coalesce(p_operation_id,gen_random_uuid()); result jsonb;
begin
  if nullif(trim(p_token),'') is null then raise exception 'portal_token_invalid' using errcode='42501'; end if;
  select * into t from public.referral_partner_access_tokens where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
  if not found or t.revoked_at is not null or t.expires_at<=now() or t.assignment_id<>p_assignment_id then raise exception 'portal_token_expired_or_revoked' using errcode='42501'; end if;
  select * into a from public.referral_assignments where id=t.assignment_id and partner_id=t.partner_id and organization_id=t.organization_id;
  if not found then raise exception 'portal_token_assignment_binding_invalid' using errcode='42501'; end if;
  select * into r from public.referral_service_requests where id=a.request_id and organization_id=a.organization_id;
  select * into s from public.service_configs where organization_id=a.organization_id and id=r.service_id;
  if not found then raise exception 'partner_service_configuration_missing' using errcode='P0002'; end if;
  if s.requires_authorization is true and coalesce(r.consent->>'status','')<>'authorized' then raise exception 'partner_assignment_not_authorized' using errcode='42501'; end if;
  result:=public.apply_partner_assignment_transition(a.id,p_action,p_note,p_appointment_at,p_follow_up_reason,p_next_followup_at,p_correction_reason,'partner',null,'referral_partner_portal_token',jsonb_build_object('token_record_id',t.id,'partner_id',t.partner_id,'assignment_id',a.id),'partner-token:'||t.id||':'||operation_id);
  update public.referral_partner_access_tokens set last_used_at=now() where id=t.id;
  return result;
end $function$
;

revoke all on function public.partner_update_referral_assignment_by_token(
  text,uuid,text,text,timestamptz,text,timestamptz,text,uuid
) from public, anon, authenticated;
grant execute on function public.partner_update_referral_assignment_by_token(
  text,uuid,text,text,timestamptz,text,timestamptz,text,uuid
) to service_role;
