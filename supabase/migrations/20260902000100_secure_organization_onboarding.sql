-- Phase 0: canonical organization creation and controlled membership changes.
-- This is additive for existing tenants.  New tenants are created only by the
-- authenticated caller through create_organization_with_owner.
begin;

alter table public.org_members
  add column if not exists active boolean not null default true;

create table if not exists public.organization_onboarding_requests (
  onboarding_request_id uuid primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  organization_id text not null unique references public.organizations(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists organization_onboarding_requests_owner_idx
  on public.organization_onboarding_requests(owner_user_id, created_at desc);

alter table public.organization_onboarding_requests enable row level security;
revoke all on table public.organization_onboarding_requests from public, anon, authenticated;
grant all on table public.organization_onboarding_requests to service_role;

-- Auth used to create a tenant as a side effect of sign-up.  That creates a
-- second tenant when the canonical post-sign-up onboarding runs, so new users
-- must now use the explicit, idempotent RPC below.
drop trigger if exists on_auth_user_created on auth.users;
revoke all on function public.handle_new_user_signup() from public, anon, authenticated;

create or replace function public.create_organization_with_owner(
  p_organization_name text,
  p_onboarding_request_id uuid
) returns table (organization_id text, organization_name text)
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(regexp_replace(btrim(coalesce(p_organization_name,'')), '\\s+', ' ', 'g'), '');
  v_slug text;
  v_organization_id text;
  v_existing public.organization_onboarding_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if p_onboarding_request_id is null then
    raise exception 'onboarding_request_id_required' using errcode='22023';
  end if;
  if v_name is null or char_length(v_name) < 3 or char_length(v_name) > 120 then
    raise exception 'organization_name_invalid' using errcode='22023';
  end if;

  select * into v_existing
  from public.organization_onboarding_requests
  where onboarding_request_id=p_onboarding_request_id
  for update;
  if found then
    if v_existing.owner_user_id <> v_user_id then
      raise exception 'onboarding_request_forbidden' using errcode='42501';
    end if;
    return query select o.id, o.name from public.organizations o where o.id=v_existing.organization_id;
    return;
  end if;

  v_slug := nullif(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), '');
  v_slug := coalesce(left(v_slug, 48), 'organization');
  v_organization_id := v_slug || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,12);

  insert into public.organizations(id,name,owner_id) values(v_organization_id,v_name,v_user_id);
  insert into public.org_members(organization_id,user_id,role,active)
    values(v_organization_id,v_user_id,'owner',true);
  insert into public.organization_onboarding_requests(onboarding_request_id,owner_user_id,organization_id)
    values(p_onboarding_request_id,v_user_id,v_organization_id);

  return query select v_organization_id, v_name;
end;
$$;
revoke all on function public.create_organization_with_owner(text,uuid) from public, anon;
grant execute on function public.create_organization_with_owner(text,uuid) to authenticated;

-- Direct browser writes cannot establish or alter membership.  service_role
-- retains its existing backend boundary.
drop policy if exists org_members_insert on public.org_members;
drop policy if exists org_members_insert_owner_admin on public.org_members;
drop policy if exists org_members_update on public.org_members;
revoke insert, update, delete on table public.org_members from public, anon, authenticated;
grant select on table public.org_members to authenticated;

drop policy if exists org_insert_authenticated on public.organizations;
revoke insert on table public.organizations from public, anon, authenticated;

create or replace function public.manage_org_member(
  p_organization_id text,
  p_target_user_id uuid,
  p_role text,
  p_active boolean default true
) returns public.org_members
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_target public.org_members%rowtype;
  v_result public.org_members%rowtype;
begin
  if v_actor is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_role not in ('owner','admin','operator') then raise exception 'invalid_member_role' using errcode='22023'; end if;
  select role into v_actor_role from public.org_members
    where organization_id=p_organization_id and user_id=v_actor and active;
  if v_actor_role not in ('owner','admin') then raise exception 'membership_admin_denied' using errcode='42501'; end if;
  if p_target_user_id=v_actor then raise exception 'self_membership_change_forbidden' using errcode='42501'; end if;
  select * into v_target from public.org_members
    where organization_id=p_organization_id and user_id=p_target_user_id for update;
  if not found then raise exception 'member_not_found' using errcode='P0002'; end if;
  if v_actor_role='admin' and (v_target.role <> 'operator' or p_role <> 'operator' or not p_active) then
    raise exception 'admin_may_manage_operators_only' using errcode='42501';
  end if;
  if v_target.role='owner' and v_target.active and (p_role <> 'owner' or not p_active)
     and not exists(select 1 from public.org_members where organization_id=p_organization_id and role='owner' and active and user_id<>p_target_user_id) then
    raise exception 'last_active_owner_required' using errcode='23514';
  end if;
  update public.org_members set role=p_role, active=p_active
    where organization_id=p_organization_id and user_id=p_target_user_id returning * into v_result;
  return v_result;
end;
$$;
revoke all on function public.manage_org_member(text,uuid,text,boolean) from public, anon;
grant execute on function public.manage_org_member(text,uuid,text,boolean) to authenticated;

commit;
