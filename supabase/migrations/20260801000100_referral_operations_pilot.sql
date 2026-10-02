-- Additive operational core for Referral Hub. Existing domain data is not changed.
-- public.referral_basket_offers remains the canonical, location-scoped price
-- source. This migration intentionally creates no basket or price table.
begin;
create extension if not exists pgcrypto;

create table if not exists public.referral_partner_contacts (
 id uuid primary key default gen_random_uuid(), organization_id text not null references public.organizations(id) on delete cascade,
 partner_id uuid not null, name text not null, role_title text,
 phone text, whatsapp text, email text, is_primary boolean not null default false, active boolean not null default true,
 service_ids text[] not null default '{}', availability jsonb not null default '{}'::jsonb, notification_priority integer not null default 100,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(phone is not null or whatsapp is not null or email is not null),
 constraint referral_partner_contacts_partner_fk foreign key(organization_id,partner_id) references public.referral_partners(organization_id,id) on delete cascade
);
create table if not exists public.referral_partner_service_rules (
 id uuid primary key default gen_random_uuid(), organization_id text not null references public.organizations(id) on delete cascade,
 partner_id uuid not null, partner_location_id uuid references public.referral_partner_locations(id) on delete cascade,
 service_id text not null, active boolean not null default true, languages text[] not null default '{}', specialties text[] not null default '{}',
 cities text[] not null default '{}', states text[] not null default '{}', postal_codes text[] not null default '{}', operating_hours jsonb not null default '{}'::jsonb,
 capacity_limit integer, assignment_priority integer not null default 100, assignment_weight integer not null default 1 check(assignment_weight>0),
 acceptance_sla_minutes integer not null default 120 check(acceptance_sla_minutes>0), preferred_notification_channel text not null default 'pending_configuration'
 check(preferred_notification_channel in ('whatsapp','email','pending_configuration')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,partner_id,partner_location_id,service_id),
 constraint referral_partner_service_rules_partner_fk foreign key(organization_id,partner_id) references public.referral_partners(organization_id,id) on delete cascade
);
create table if not exists public.referral_service_requests (
 id uuid primary key default gen_random_uuid(), organization_id text not null references public.organizations(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade, service_id text not null, source_channel text, source_campaign text, city text, postal_code text,
 language text, specialty text, intake jsonb not null default '{}'::jsonb, intake_complete boolean not null default false, consent jsonb not null default '{}'::jsonb,
 status text not null default 'new' check(status in ('new','collecting','prequalified','qualified','disqualified','closed')), priority integer not null default 0,
 completion_key text not null, closed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,lead_id,service_id,completion_key)
);
create unique index if not exists referral_requests_one_active_service
 on public.referral_service_requests(organization_id,lead_id,service_id)
 where status in ('new','collecting','prequalified','qualified');
create table if not exists public.referral_assignments (
 id uuid primary key default gen_random_uuid(), organization_id text not null references public.organizations(id) on delete cascade,
 request_id uuid not null references public.referral_service_requests(id) on delete cascade, partner_id uuid not null,
 partner_location_id uuid references public.referral_partner_locations(id) on delete restrict, partner_contact_id uuid references public.referral_partner_contacts(id) on delete restrict,
 assignment_mode text not null check(assignment_mode in ('automatic','manual')), assignment_rule text not null, assignment_reason jsonb not null default '{}'::jsonb,
 attempt_number integer not null check(attempt_number>0), idempotency_key text not null, assigned_at timestamptz not null default now(),
 assigned_by_type text not null check(assigned_by_type in ('system','user')), assigned_by uuid, acceptance_deadline timestamptz,
 status text not null default 'assigned' check(status in ('pending_assignment','assigned','accepted','rejected','expired','reassigned','cancelled')),
 work_status text not null default 'new' check(work_status in ('new','contacted','appointment_scheduled','in_progress','converted','not_converted','closed')),
 accepted_at timestamptz, rejected_at timestamptz, rejection_reason text, expired_at timestamptz, failure_reason text,
 superseded_by_assignment_id uuid references public.referral_assignments(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,idempotency_key), unique(request_id,attempt_number),
 constraint referral_assignments_partner_fk foreign key(organization_id,partner_id) references public.referral_partners(organization_id,id) on delete restrict
);
create unique index if not exists referral_assignments_one_active_request on public.referral_assignments(request_id) where status in ('pending_assignment','assigned','accepted');
create table if not exists public.referral_notification_attempts (
 id uuid primary key default gen_random_uuid(), organization_id text not null references public.organizations(id) on delete cascade,
 assignment_id uuid not null references public.referral_assignments(id) on delete cascade, channel text not null check(channel in ('whatsapp','email','pending_configuration')),
 destination_reference text, template_key text, status text not null default 'queued' check(status in ('queued','sent','delivered','failed')), provider_message_id text,
 attempt_number integer not null default 1, correlation_id uuid not null default gen_random_uuid(), idempotency_key text not null, queued_at timestamptz not null default now(),
 sent_at timestamptz, delivered_at timestamptz, failure_code text, failure_detail text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,idempotency_key)
);
create table if not exists public.referral_operational_events (
 id uuid primary key default gen_random_uuid(), organization_id text not null references public.organizations(id) on delete cascade,
 aggregate_type text not null, aggregate_id uuid not null, event_type text not null, actor_type text not null check(actor_type in ('system','user','partner','provider')),
 actor_id uuid, source text not null, previous_state jsonb, new_state jsonb, metadata jsonb not null default '{}'::jsonb,
 correlation_id uuid not null default gen_random_uuid(), idempotency_key text, occurred_at timestamptz not null default now()
);
create unique index if not exists referral_operational_events_idempotency on public.referral_operational_events(organization_id,idempotency_key) where idempotency_key is not null;
create table if not exists public.referral_operational_exceptions (
 id uuid primary key default gen_random_uuid(), organization_id text not null references public.organizations(id) on delete cascade,
 aggregate_type text not null, aggregate_id uuid not null, exception_type text not null, status text not null default 'open' check(status in ('open','resolved','dismissed')),
 severity text not null default 'medium' check(severity in ('low','medium','high','critical')), summary text not null, details jsonb not null default '{}'::jsonb,
 resolution_reason text, resolved_by uuid, resolved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.referral_partner_access_tokens (
 id uuid primary key default gen_random_uuid(), organization_id text not null references public.organizations(id) on delete cascade,
 assignment_id uuid not null references public.referral_assignments(id) on delete cascade, partner_id uuid not null,
 token_hash text not null unique, expires_at timestamptz not null, revoked_at timestamptz, last_used_at timestamptz, created_at timestamptz not null default now(),
 constraint referral_partner_access_tokens_partner_fk foreign key(organization_id,partner_id) references public.referral_partners(organization_id,id) on delete cascade
);
create unique index if not exists referral_partner_access_tokens_one_active_assignment
 on public.referral_partner_access_tokens(assignment_id) where revoked_at is null;
create table if not exists public.referral_conversation_operations (
 organization_id text not null references public.organizations(id) on delete cascade, lead_id uuid not null references public.leads(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','resolved')), owner_user_id uuid, unread_count integer not null default 0,
 automation_paused boolean not null default false, automation_paused_until timestamptz, updated_at timestamptz not null default now(), primary key(organization_id,lead_id)
);
create table if not exists public.referral_internal_notes (
 id uuid primary key default gen_random_uuid(), organization_id text not null references public.organizations(id) on delete cascade,
 aggregate_type text not null, aggregate_id uuid not null, body text not null check(length(body) between 1 and 4000), author_user_id uuid not null, created_at timestamptz not null default now()
);
create index if not exists referral_requests_queue_idx on public.referral_service_requests(organization_id,status,created_at desc);
create index if not exists referral_assignments_queue_idx on public.referral_assignments(organization_id,status,acceptance_deadline);
create index if not exists referral_notifications_queue_idx on public.referral_notification_attempts(organization_id,status,queued_at);
create index if not exists referral_events_timeline_idx on public.referral_operational_events(organization_id,aggregate_type,aggregate_id,occurred_at desc);
create index if not exists referral_exceptions_queue_idx on public.referral_operational_exceptions(organization_id,status,severity,created_at desc);

create or replace function public.referral_validate_partner_location_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.partner_location_id is not null and not exists(
   select 1 from public.referral_partner_locations l
   where l.id=new.partner_location_id and l.organization_id=new.organization_id and l.partner_id=new.partner_id
 ) then raise exception 'partner_location_scope_mismatch' using errcode='23503'; end if;
 return new;
end $$;
revoke all on function public.referral_validate_partner_location_scope() from public,anon,authenticated;
create trigger referral_rules_validate_location before insert or update of organization_id,partner_id,partner_location_id on public.referral_partner_service_rules for each row execute function public.referral_validate_partner_location_scope();
create trigger referral_assignments_validate_location before insert or update of organization_id,partner_id,partner_location_id on public.referral_assignments for each row execute function public.referral_validate_partner_location_scope();

create or replace function public.referral_validate_operational_tenant_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='referral_service_requests' then
  if not exists(select 1 from public.leads l where l.id=new.lead_id and l.organization_id=new.organization_id) then
   raise exception 'operational_tenant_scope_mismatch' using errcode='23503';
  end if;
 elsif tg_table_name='referral_assignments' then
  if not exists(select 1 from public.referral_service_requests r where r.id=new.request_id and r.organization_id=new.organization_id)
   or (new.partner_contact_id is not null and not exists(
    select 1 from public.referral_partner_contacts c where c.id=new.partner_contact_id and c.organization_id=new.organization_id and c.partner_id=new.partner_id
   )) then raise exception 'operational_tenant_scope_mismatch' using errcode='23503'; end if;
 elsif tg_table_name='referral_notification_attempts' then
  if not exists(select 1 from public.referral_assignments a where a.id=new.assignment_id and a.organization_id=new.organization_id) then
   raise exception 'operational_tenant_scope_mismatch' using errcode='23503';
  end if;
 elsif tg_table_name='referral_partner_access_tokens' then
  if not exists(select 1 from public.referral_assignments a where a.id=new.assignment_id and a.organization_id=new.organization_id and a.partner_id=new.partner_id) then
   raise exception 'operational_tenant_scope_mismatch' using errcode='23503';
  end if;
 elsif tg_table_name='referral_conversation_operations' then
  if not exists(select 1 from public.leads l where l.id=new.lead_id and l.organization_id=new.organization_id) then
   raise exception 'operational_tenant_scope_mismatch' using errcode='23503';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.referral_validate_operational_tenant_scope() from public,anon,authenticated;
create trigger referral_requests_validate_tenant before insert or update of organization_id,lead_id on public.referral_service_requests for each row execute function public.referral_validate_operational_tenant_scope();
create trigger referral_assignments_validate_tenant before insert or update of organization_id,request_id,partner_id,partner_contact_id on public.referral_assignments for each row execute function public.referral_validate_operational_tenant_scope();
create trigger referral_notifications_validate_tenant before insert or update of organization_id,assignment_id on public.referral_notification_attempts for each row execute function public.referral_validate_operational_tenant_scope();
create trigger referral_tokens_validate_tenant before insert or update of organization_id,assignment_id,partner_id on public.referral_partner_access_tokens for each row execute function public.referral_validate_operational_tenant_scope();
create trigger referral_conversations_validate_tenant before insert or update of organization_id,lead_id on public.referral_conversation_operations for each row execute function public.referral_validate_operational_tenant_scope();

create or replace function public.referral_is_member(p_organization_id text,p_roles text[] default null) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.org_members m where m.organization_id=p_organization_id and m.user_id=auth.uid() and (p_roles is null or m.role=any(p_roles)));
$$;
revoke all on function public.referral_is_member(text,text[]) from public,anon; grant execute on function public.referral_is_member(text,text[]) to authenticated;
grant select on table public.referral_coupon_campaigns,
 public.referral_coupon_delivery_events to authenticated;
create policy referral_coupon_campaigns_admin_read on public.referral_coupon_campaigns
 for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
create policy referral_coupon_delivery_events_admin_read on public.referral_coupon_delivery_events
 for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
do $$ declare t text; begin foreach t in array array['referral_partner_contacts','referral_partner_service_rules','referral_service_requests','referral_assignments','referral_notification_attempts','referral_operational_events','referral_operational_exceptions','referral_partner_access_tokens','referral_conversation_operations','referral_internal_notes'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
do $$ declare t text; begin foreach t in array array['referral_partner_contacts','referral_partner_service_rules','referral_service_requests','referral_assignments','referral_notification_attempts','referral_operational_events','referral_operational_exceptions','referral_conversation_operations','referral_internal_notes'] loop execute format('revoke all on table public.%I from public,anon,authenticated',t); execute format('grant select on table public.%I to authenticated',t); end loop; end $$;
grant all on table
 public.referral_partner_contacts,
 public.referral_partner_service_rules,
 public.referral_service_requests,
 public.referral_assignments,
 public.referral_notification_attempts,
 public.referral_operational_events,
 public.referral_operational_exceptions,
 public.referral_partner_access_tokens,
 public.referral_conversation_operations,
 public.referral_internal_notes
to service_role;
create policy referral_contacts_member_read on public.referral_partner_contacts for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
create policy referral_rules_member_read on public.referral_partner_service_rules for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
create policy referral_requests_member_read on public.referral_service_requests for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
create policy referral_assignments_member_read on public.referral_assignments for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
create policy referral_notifications_member_read on public.referral_notification_attempts for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
create policy referral_events_member_read on public.referral_operational_events for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
create policy referral_exceptions_member_read on public.referral_operational_exceptions for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
create policy referral_conversations_member_read on public.referral_conversation_operations for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
create policy referral_notes_member_read on public.referral_internal_notes for select to authenticated using(public.referral_is_member(organization_id,array['owner','admin']));
revoke all on table public.referral_partner_access_tokens from anon,authenticated;

create or replace function public.assign_referral_request(p_organization_id text,p_request_id uuid,p_idempotency_key text,p_mode text default 'automatic',p_partner_id uuid default null,p_partner_contact_id uuid default null)
returns public.referral_assignments language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.referral_service_requests%rowtype; rule public.referral_partner_service_rules%rowtype; contact public.referral_partner_contacts%rowtype; result public.referral_assignments%rowtype; attempt integer;
begin
 if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if not public.referral_is_member(p_organization_id,array['owner','admin']) then raise exception 'referral_access_denied' using errcode='42501'; end if;
 if p_mode not in ('automatic','manual') then raise exception 'invalid_assignment_mode'; end if;
 select * into result from public.referral_assignments where organization_id=p_organization_id and idempotency_key=p_idempotency_key; if found then return result; end if;
 select * into r from public.referral_service_requests where id=p_request_id and organization_id=p_organization_id for update; if not found then raise exception 'request_not_found' using errcode='P0002'; end if;
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
end $$;
create or replace function public.resolve_referral_exception(p_organization_id text,p_exception_id uuid,p_resolution text,p_dismiss boolean default false) returns public.referral_operational_exceptions language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.referral_operational_exceptions%rowtype; begin if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if; if not public.referral_is_member(p_organization_id,array['owner','admin']) then raise exception 'referral_access_denied' using errcode='42501'; end if;
 update public.referral_operational_exceptions set status=case when p_dismiss then 'dismissed' else 'resolved' end,resolution_reason=p_resolution,resolved_by=auth.uid(),resolved_at=now(),updated_at=now() where id=p_exception_id and organization_id=p_organization_id and status='open' returning * into result;
 if not found then raise exception 'exception_not_found' using errcode='P0002'; end if; insert into public.referral_operational_events(organization_id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,source,new_state) values(p_organization_id,'exception',result.id,'exception_'||result.status,'user',auth.uid(),'resolve_referral_exception',to_jsonb(result)); return result; end $$;

-- Private, service-role-only bridge from a confirmed Referral Hub completion
-- to the canonical operational request and assignment records. Partner choice
-- is deterministic from reviewed rules; no browser or LLM may call this path.
create or replace function public.orchestrate_referral_service_request(
 p_organization_id text,
 p_lead_id uuid,
 p_service_id text,
 p_source_channel text,
 p_channel_user_id text,
 p_completion_key text,
 p_completion_outcome text,
 p_intake jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 lead_row public.leads%rowtype;
 request_row public.referral_service_requests%rowtype;
 rule_row public.referral_partner_service_rules%rowtype;
 contact_row public.referral_partner_contacts%rowtype;
 assignment_row public.referral_assignments%rowtype;
 notification_row public.referral_notification_attempts%rowtype;
 exception_row public.referral_operational_exceptions%rowtype;
 token_plain text;
 token_hash_value text;
 request_created boolean := false;
 replay boolean := false;
 attempt integer;
 request_city text;
 request_postal text;
 request_language text;
 request_specialty text;
 outcome text;
begin
 if coalesce(auth.role(),'') <> 'service_role' then
  raise exception 'service_role_required' using errcode='42501';
 end if;
 if p_organization_id <> 'luis-gabriel-referral-hub' then
  raise exception 'referral_orchestration_tenant_forbidden' using errcode='42501';
 end if;
 if p_service_id not in ('luis_accidente','luis_inmigracion','luis_eventos','luis_representante') then
  raise exception 'referral_orchestration_service_forbidden' using errcode='22023';
 end if;
 if p_source_channel not in ('messenger','whatsapp') or nullif(trim(p_channel_user_id),'') is null then
  raise exception 'referral_orchestration_identity_invalid' using errcode='22023';
 end if;
 if nullif(trim(p_completion_key),'') is null or jsonb_typeof(coalesce(p_intake,'{}'::jsonb)) <> 'object' then
  raise exception 'referral_orchestration_completion_invalid' using errcode='22023';
 end if;
 if p_service_id='luis_eventos' and p_completion_outcome <> 'follow_up_requested' then
  raise exception 'referral_event_follow_up_required' using errcode='22023';
 elsif p_service_id<>'luis_eventos' and p_completion_outcome <> 'confirmed_intake' then
  raise exception 'referral_intake_confirmation_required' using errcode='22023';
 end if;

 perform pg_advisory_xact_lock(hashtextextended(
  p_organization_id||':'||p_lead_id::text||':'||p_service_id,
  0
 ));

 select * into lead_row from public.leads
 where id=p_lead_id and organization_id=p_organization_id
 for update;
 if not found then raise exception 'referral_lead_not_found' using errcode='P0002'; end if;
 if coalesce(to_jsonb(lead_row)->>'channel','') <> p_source_channel
    or coalesce(to_jsonb(lead_row)->>'channel_user_id','') <> p_channel_user_id then
  raise exception 'referral_conversation_identity_mismatch' using errcode='42501';
 end if;

 request_city := coalesce(
  nullif(p_intake->>'accident_city',''), nullif(p_intake->>'profile_city',''),
  nullif(p_intake->>'city','')
 );
 request_postal := nullif(p_intake->>'postal_code','');
 request_language := nullif(p_intake->>'language','');
 request_specialty := nullif(p_intake->>'specialty','');

 select * into request_row from public.referral_service_requests
 where organization_id=p_organization_id and lead_id=p_lead_id
  and service_id=p_service_id
  and status in ('new','collecting','prequalified','qualified')
 order by created_at desc limit 1 for update;
 if found then
  replay := true;
 else
  insert into public.referral_service_requests(
   organization_id,lead_id,service_id,source_channel,source_campaign,city,
   postal_code,language,specialty,intake,intake_complete,status,completion_key
  ) values (
   p_organization_id,p_lead_id,p_service_id,p_source_channel,
   nullif(p_intake->>'source_campaign',''),request_city,request_postal,
   request_language,request_specialty,p_intake,true,'prequalified',p_completion_key
  ) on conflict(organization_id,lead_id,service_id,completion_key) do nothing
  returning * into request_row;
  if found then
   request_created := true;
  else
   replay := true;
   select * into request_row from public.referral_service_requests
   where organization_id=p_organization_id and lead_id=p_lead_id
    and service_id=p_service_id and completion_key=p_completion_key;
  end if;
 end if;
 if request_created then
  insert into public.referral_operational_events(
   organization_id,aggregate_type,aggregate_id,event_type,actor_type,source,
   new_state,metadata,idempotency_key
  ) values (
   p_organization_id,'request',request_row.id,'request_prequalified','system',
   'orchestrate_referral_service_request',to_jsonb(request_row),
   jsonb_build_object('service_id',p_service_id,'completion_outcome',p_completion_outcome),
   p_completion_key||':request'
  ) on conflict do nothing;
 end if;

 select * into assignment_row from public.referral_assignments
 where request_id=request_row.id
  and status in ('pending_assignment','assigned','accepted')
 order by attempt_number desc limit 1;
 if found then
  select * into notification_row from public.referral_notification_attempts
  where assignment_id=assignment_row.id order by attempt_number desc limit 1;
  return jsonb_build_object(
   'success',true,'outcome','assigned','idempotent_replay',true,
   'request_id',request_row.id,'request_status',request_row.status,
   'assignment_id',assignment_row.id,'assignment_status',assignment_row.status,
   'notification_id',notification_row.id,'notification_status',notification_row.status,
   'exception_id',null,'portal_token',null
  );
 end if;

 select * into exception_row from public.referral_operational_exceptions
 where organization_id=p_organization_id and aggregate_type='request'
  and aggregate_id=request_row.id and status='open'
  and exception_type in ('no_eligible_partner','missing_partner_contact','missing_notification_destination')
 order by created_at desc limit 1;
 if found then
  return jsonb_build_object(
   'success',true,'outcome','needs_coordinator_review','idempotent_replay',true,
   'request_id',request_row.id,'request_status',request_row.status,
   'assignment_id',null,'notification_id',null,
   'exception_id',exception_row.id,'exception_type',exception_row.exception_type,
   'portal_token',null
  );
 end if;

 select candidate.* into rule_row
 from public.referral_partner_service_rules candidate
 join public.referral_partners partner
  on partner.id=candidate.partner_id
 and partner.organization_id=candidate.organization_id
 where candidate.organization_id=p_organization_id
  and candidate.service_id=p_service_id and candidate.active
  and coalesce((to_jsonb(partner)->>'active')::boolean,true)
  and (cardinality(candidate.cities)=0 or request_city=any(candidate.cities))
  and (cardinality(candidate.states)=0 or coalesce(p_intake->>'state','')=any(candidate.states))
  and (cardinality(candidate.postal_codes)=0 or request_postal=any(candidate.postal_codes))
  and (cardinality(candidate.languages)=0 or request_language=any(candidate.languages))
  and (cardinality(candidate.specialties)=0 or request_specialty=any(candidate.specialties))
  and (candidate.capacity_limit is null or candidate.capacity_limit > (
   select count(*) from public.referral_assignments active_assignment
   where active_assignment.partner_id=candidate.partner_id
    and active_assignment.status in ('assigned','accepted')
  ))
 order by candidate.assignment_priority,
  (select count(*)::numeric/greatest(candidate.assignment_weight,1)
   from public.referral_assignments active_assignment
   where active_assignment.partner_id=candidate.partner_id
    and active_assignment.status in ('assigned','accepted')),
  candidate.partner_id
 for update of candidate skip locked limit 1;

 if not found then
  insert into public.referral_operational_exceptions(
   organization_id,aggregate_type,aggregate_id,exception_type,severity,summary,details
  ) values (
   p_organization_id,'request',request_row.id,'no_eligible_partner','high',
   'No hay un aliado elegible para esta solicitud',
   jsonb_build_object('service_id',p_service_id)
  ) returning * into exception_row;
  outcome := 'needs_coordinator_review';
  insert into public.referral_operational_events(
   organization_id,aggregate_type,aggregate_id,event_type,actor_type,source,
   new_state,metadata,idempotency_key
  ) values (
   p_organization_id,'request',request_row.id,'assignment_unavailable','system',
   'orchestrate_referral_service_request',to_jsonb(exception_row),
   jsonb_build_object('reason','no_eligible_partner'),p_completion_key||':outcome'
  ) on conflict do nothing;
  return jsonb_build_object(
   'success',true,'outcome',outcome,'idempotent_replay',replay,
   'request_id',request_row.id,'request_status',request_row.status,
   'assignment_id',null,'notification_id',null,
   'exception_id',exception_row.id,'exception_type',exception_row.exception_type,
   'portal_token',null
  );
 end if;

 select * into contact_row from public.referral_partner_contacts contact
 where contact.organization_id=p_organization_id
  and contact.partner_id=rule_row.partner_id and contact.active
  and (cardinality(contact.service_ids)=0 or p_service_id=any(contact.service_ids))
  and (
   rule_row.preferred_notification_channel='pending_configuration'
   or (rule_row.preferred_notification_channel='whatsapp' and nullif(contact.whatsapp,'') is not null)
   or (rule_row.preferred_notification_channel='email' and nullif(contact.email,'') is not null)
  )
 order by contact.is_primary desc,contact.notification_priority,contact.id limit 1;
 if not found then
  insert into public.referral_operational_exceptions(
   organization_id,aggregate_type,aggregate_id,exception_type,severity,summary,details
  ) values (
   p_organization_id,'request',request_row.id,'missing_partner_contact','high',
   'El aliado elegible no tiene un contacto o destino activo',
   jsonb_build_object('partner_id',rule_row.partner_id,'service_id',p_service_id)
  ) returning * into exception_row;
  insert into public.referral_operational_events(
   organization_id,aggregate_type,aggregate_id,event_type,actor_type,source,
   new_state,metadata,idempotency_key
  ) values (
   p_organization_id,'request',request_row.id,'assignment_unavailable','system',
   'orchestrate_referral_service_request',to_jsonb(exception_row),
   jsonb_build_object('reason','missing_partner_contact'),p_completion_key||':outcome'
  ) on conflict do nothing;
  return jsonb_build_object(
   'success',true,'outcome','needs_coordinator_review','idempotent_replay',replay,
   'request_id',request_row.id,'request_status',request_row.status,
   'assignment_id',null,'notification_id',null,
   'exception_id',exception_row.id,'exception_type',exception_row.exception_type,
   'portal_token',null
  );
 end if;

 select coalesce(max(attempt_number),0)+1 into attempt
 from public.referral_assignments where request_id=request_row.id;
 insert into public.referral_assignments(
  organization_id,request_id,partner_id,partner_location_id,partner_contact_id,
  assignment_mode,assignment_rule,assignment_reason,attempt_number,
  idempotency_key,assigned_by_type,acceptance_deadline
 ) values (
  p_organization_id,request_row.id,rule_row.partner_id,rule_row.partner_location_id,
  contact_row.id,'automatic','service_geo_priority_weight_capacity',
  jsonb_build_object('service_id',p_service_id,'rule_id',rule_row.id,
   'priority',rule_row.assignment_priority,'weight',rule_row.assignment_weight,
   'internal',p_service_id='luis_representante'),
  attempt,p_completion_key||':assignment','system',
  now()+make_interval(mins=>rule_row.acceptance_sla_minutes)
 ) returning * into assignment_row;

 insert into public.referral_notification_attempts(
  organization_id,assignment_id,channel,destination_reference,status,idempotency_key
 ) values (
  p_organization_id,assignment_row.id,rule_row.preferred_notification_channel,
  case rule_row.preferred_notification_channel
   when 'whatsapp' then contact_row.whatsapp
   when 'email' then contact_row.email else null end,
  'queued',p_completion_key||':notification'
 ) returning * into notification_row;

 if p_service_id <> 'luis_representante' then
  token_plain := encode(extensions.gen_random_bytes(32),'hex');
  token_hash_value := encode(extensions.digest(token_plain,'sha256'),'hex');
  insert into public.referral_partner_access_tokens(
   organization_id,assignment_id,partner_id,token_hash,expires_at
  ) values (
   p_organization_id,assignment_row.id,assignment_row.partner_id,
   token_hash_value,now()+interval '7 days'
  );
 end if;

 insert into public.referral_operational_events(
  organization_id,aggregate_type,aggregate_id,event_type,actor_type,source,
  new_state,metadata,idempotency_key
 ) values
  (p_organization_id,'assignment',assignment_row.id,'assignment_created','system',
   'orchestrate_referral_service_request',to_jsonb(assignment_row),
   jsonb_build_object('request_id',request_row.id),p_completion_key||':assignment_event'),
  (p_organization_id,'notification',notification_row.id,'notification_queued','system',
   'orchestrate_referral_service_request',to_jsonb(notification_row),
   jsonb_build_object('assignment_id',assignment_row.id),p_completion_key||':notification_event')
 on conflict do nothing;

 return jsonb_build_object(
  'success',true,'outcome','assigned','idempotent_replay',replay,
  'request_id',request_row.id,'request_status',request_row.status,
  'assignment_id',assignment_row.id,'assignment_status',assignment_row.status,
  'notification_id',notification_row.id,'notification_status',notification_row.status,
  'exception_id',null,'portal_token',token_plain,
  'assignment_kind',case when p_service_id='luis_representante' then 'internal' else 'partner' end
 );
end $$;

revoke all on function public.assign_referral_request(text,uuid,text,text,uuid,uuid) from public,anon;
revoke all on function public.resolve_referral_exception(text,uuid,text,boolean) from public,anon;
revoke all on function public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.assign_referral_request(text,uuid,text,text,uuid,uuid) to authenticated;
grant execute on function public.resolve_referral_exception(text,uuid,text,boolean) to authenticated;
grant execute on function public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb) to service_role;
commit;
