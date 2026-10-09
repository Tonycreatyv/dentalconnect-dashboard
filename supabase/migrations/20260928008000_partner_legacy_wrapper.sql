-- Reconstructed from the live production schema on 2026-10-02.
CREATE OR REPLACE FUNCTION public.partner_update_immigration_assignment(p_assignment_id uuid, p_action text, p_note text DEFAULT NULL::text, p_appointment_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_follow_up_reason text DEFAULT NULL::text, p_next_followup_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_correction_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return public.partner_update_referral_assignment(p_assignment_id,p_action,p_note,p_appointment_at,p_follow_up_reason,p_next_followup_at,p_correction_reason,null);
end $function$
;

revoke all on function public.partner_update_immigration_assignment(
  uuid,text,text,timestamptz,text,timestamptz,text
) from public, anon;
grant execute on function public.partner_update_immigration_assignment(
  uuid,text,text,timestamptz,text,timestamptz,text
) to authenticated, service_role;
