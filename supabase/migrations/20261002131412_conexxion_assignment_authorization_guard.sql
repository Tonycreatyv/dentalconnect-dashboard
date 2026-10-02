-- ConeXXion V2: assignment authorization invariant.
-- Repository-only until final production approval.

CREATE OR REPLACE FUNCTION public.assign_referral_request(p_organization_id text, p_request_id uuid, p_idempotency_key text, p_mode text DEFAULT 'automatic'::text, p_partner_id uuid DEFAULT NULL::uuid, p_partner_contact_id uuid DEFAULT NULL::uuid)
 RETURNS referral_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r public.referral_service_requests%rowtype; s public.service_configs%rowtype; rule public.referral_partner_service_rules%rowtype; contact public.referral_partner_contacts%rowtype; result public.referral_assignments%rowtype; attempt integer;
begin
 if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if not public.referral_is_member(p_organization_id,array['owner','admin']) then raise exception 'referral_access_denied' using errcode='42501'; end if;
 if p_mode not in ('automatic','manual') then raise exception 'invalid_assignment_mode'; end if;
 select * into result from public.referral_assignments where organization_id=p_organization_id and idempotency_key=p_idempotency_key; if found then return result; end if;
 select * into r from public.referral_service_requests where id=p_request_id and organization_id=p_organization_id for update; if not found then raise exception 'request_not_found' using errcode='P0002'; end if;
 select * into s from public.service_configs where organization_id=p_organization_id and id=r.service_id;
 if not found then raise exception 'partner_service_configuration_missing' using errcode='P0002'; end if;
 if s.requires_authorization is true and coalesce(r.consent->>'status','') <> 'authorized' then
   raise exception 'referral_request_not_authorized' using errcode='42501';
 end if;
 select * into result from public.referral_assignments where request_id=r.id and status in ('pending_assignment','assigned','accepted'); if found then return result; end if;
 select x.* into rule from public.referral_partner_service_rules x join public.referral_partners p on p.id=x.partner_id and p.organization_id=x.organization_id
 where x.organization_id=p_organization_id and x.service_id=r.service_id and x.active and coalesce((to_jsonb(p)->>'active')::boolean,true)
 and (p_partner_id is null or x.partner_id=p_partner_id) and (cardinality(x.cities)=0 or r.city=any(x.cities)) and (cardinality(x.postal_codes)=0 or r.postal_code=any(x.postal_codes))
 and (cardinality(x.languages)=0 or r.language=any(x.languages)) and (cardinality(x.specialties)=0 or r.specialty=any(x.specialties))
 order by x.assignment_priority,coalesce((select count(*) from public.referral_assignments a where a.partner_id=x.partner_id and a.status in ('assigned','accepted')),0),x.partner_id for update of x skip locked limit 1;
 if not found then insert into public.referral_operational_exceptions(organization_id,aggregate_type,aggregate_id,exception_type,severity,summary) values(p_organization_id,'request',r.id,'no_eligible_partner','high','No hay un aliado elegible para esta solicitud'); return result; end if;
 select * into contact from public.referral_partner_contacts c where c.organization_id=p_organization_id and c.partner_id=rule.partner_id and c.active and (p_partner_contact_id is null or c.id=p_partner_contact_id) and (cardinality(c.service_ids)=0 or r.service_id=any(c.service_ids)) order by c.is_primary desc,c.notification_priority,c.id limit 1;
 if not found then insert into public.referral_operational_exceptions(organization_id,aggregate_type,aggregate_id,exception_type,severity,summary,details) values(p_organization_id,'request',r.id,'missing_partner_contact','high','El aliado elegible no tiene un contacto activo',jsonb_build_object('partner_id',rule.partner_id)); return result; end if;
 select coalesce(max(attempt_number),0)+1 into attempt from public.referral_assignments where request_id=r.id;
 insert into public.referral_assignments(organization_id,request_id,partner_id,partner_location_id,partner_contact_id,assignment_mode,assignment_rule,assignment_reason,attempt_number,idempotency_key,assigned_by_type,assigned_by,acceptance_deadline)
 values(p_organization_id,r.id,rule.partner_id,rule.partner_location_id,contact.id,p_mode,'service_geo_priority_load',jsonb_build_object('service_id',r.service_id,'rule_id',rule.id,'priority',rule.assignment_priority,'weight',rule.assignment_weight),attempt,p_idempotency_key,case when auth.uid() is null then 'system' else 'user' end,auth.uid(),now()+make_interval(mins=>rule.acceptance_sla_minutes)) returning * into result;
 insert into public.referral_notification_attempts(organization_id,assignment_id,channel,destination_reference,status,idempotency_key) values(p_organization_id,result.id,rule.preferred_notification_channel,case rule.preferred_notification_channel when 'whatsapp' then contact.whatsapp when 'email' then contact.email else null end,'queued',p_idempotency_key||':notify');
 insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,source,new_state,metadata,idempotency_key) values(p_organization_id,'assignment',result.id,'assignment_created',case when auth.uid() is null then 'system' else 'user' end,auth.uid(),'assign_referral_request',to_jsonb(result),jsonb_build_object('request_id',r.id),p_idempotency_key||':event'); return result;
end $function$
;

revoke all on function public.assign_referral_request(text,uuid,text,text,uuid,uuid)
  from public, anon;
grant execute on function public.assign_referral_request(text,uuid,text,text,uuid,uuid)
  to authenticated, service_role;
