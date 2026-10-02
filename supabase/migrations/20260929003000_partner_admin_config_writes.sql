-- Reconstructed from the live production schema on 2026-10-02.

CREATE OR REPLACE FUNCTION public.admin_save_referral_partner_service_rule(p_organization_id text, p_rule_id uuid, p_partner_id uuid, p_service_id text, p_active boolean, p_assignment_priority integer, p_partner_location_id uuid, p_postal_codes text[], p_cities text[], p_languages text[], p_specialties text[], p_capacity_limit integer, p_acceptance_sla_minutes integer, p_starts_at timestamp with time zone, p_expires_at timestamp with time zone, p_workspace_config jsonb)
 RETURNS referral_partner_service_rules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result public.referral_partner_service_rules%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not public.referral_is_member(p_organization_id, array['owner','admin']) then raise exception 'partner_config_admin_denied' using errcode='42501'; end if;
  if not exists(select 1 from public.referral_partners where id=p_partner_id and organization_id=p_organization_id) then raise exception 'partner_config_partner_not_found' using errcode='23503'; end if;
  if not exists(select 1 from public.service_configs where id=p_service_id and organization_id=p_organization_id) then raise exception 'partner_config_service_not_found' using errcode='23503'; end if;
  if p_partner_location_id is not null and not exists(select 1 from public.referral_partner_locations where id=p_partner_location_id and partner_id=p_partner_id and organization_id=p_organization_id) then raise exception 'partner_location_scope_mismatch' using errcode='23503'; end if;
  if p_assignment_priority < 0 or p_capacity_limit is not null and p_capacity_limit < 1 or p_acceptance_sla_minutes is not null and p_acceptance_sla_minutes < 1 then raise exception 'invalid_partner_rule_value' using errcode='22023'; end if;
  if p_expires_at is not null and p_starts_at is not null and p_expires_at <= p_starts_at then raise exception 'referral_partner_service_rules_valid_window' using errcode='23514'; end if;
  if not public.referral_workspace_config_is_valid(coalesce(p_workspace_config,'{}'::jsonb)) then raise exception 'invalid_workspace_config' using errcode='22023'; end if;
  if p_rule_id is null then
    insert into public.referral_partner_service_rules(organization_id,partner_id,service_id,active,assignment_priority,partner_location_id,postal_codes,cities,languages,specialties,capacity_limit,acceptance_sla_minutes,starts_at,expires_at,workspace_config)
    values(p_organization_id,p_partner_id,p_service_id,p_active,p_assignment_priority,p_partner_location_id,coalesce(p_postal_codes,'{}'),coalesce(p_cities,'{}'),coalesce(p_languages,'{}'),coalesce(p_specialties,'{}'),p_capacity_limit,coalesce(p_acceptance_sla_minutes,120),p_starts_at,p_expires_at,coalesce(p_workspace_config,'{}')) returning * into result;
  else
    update public.referral_partner_service_rules set active=p_active,assignment_priority=p_assignment_priority,partner_location_id=p_partner_location_id,postal_codes=coalesce(p_postal_codes,'{}'),cities=coalesce(p_cities,'{}'),languages=coalesce(p_languages,'{}'),specialties=coalesce(p_specialties,'{}'),capacity_limit=p_capacity_limit,acceptance_sla_minutes=coalesce(p_acceptance_sla_minutes,120),starts_at=p_starts_at,expires_at=p_expires_at,workspace_config=coalesce(p_workspace_config,'{}'),updated_at=now()
    where id=p_rule_id and organization_id=p_organization_id and partner_id=p_partner_id and service_id=p_service_id returning * into result;
    if not found then raise exception 'partner_config_rule_not_found' using errcode='P0002'; end if;
  end if;
  return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_update_referral_partner_membership(p_organization_id text, p_membership_id uuid, p_role text, p_active boolean)
 RETURNS referral_partner_memberships
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result public.referral_partner_memberships%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not public.referral_is_member(p_organization_id,array['owner','admin']) then raise exception 'partner_config_admin_denied' using errcode='42501'; end if;
  if p_role not in ('partner_admin','partner_agent') then raise exception 'invalid_partner_role' using errcode='22023'; end if;
  update public.referral_partner_memberships set role=p_role,active=p_active,updated_at=now() where id=p_membership_id and organization_id=p_organization_id returning * into result;
  if not found then raise exception 'partner_config_membership_not_found' using errcode='P0002'; end if;
  return result;
end $function$
;

revoke all on function public.admin_save_referral_partner_service_rule(
  text,uuid,uuid,text,boolean,integer,uuid,text[],text[],text[],text[],integer,integer,timestamptz,timestamptz,jsonb
) from public, anon;
grant execute on function public.admin_save_referral_partner_service_rule(
  text,uuid,uuid,text,boolean,integer,uuid,text[],text[],text[],text[],integer,integer,timestamptz,timestamptz,jsonb
) to authenticated, service_role;

revoke all on function public.admin_update_referral_partner_membership(
  text,uuid,text,boolean
) from public, anon;
grant execute on function public.admin_update_referral_partner_membership(
  text,uuid,text,boolean
) to authenticated, service_role;
