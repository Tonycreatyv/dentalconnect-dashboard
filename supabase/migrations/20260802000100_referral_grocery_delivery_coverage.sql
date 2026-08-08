-- Additive, grocery-only delivery coverage. This does not alter general partner
-- service routing and does not calculate distance for non-grocery services.
begin;

create table public.referral_grocery_delivery_coverage (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  partner_location_id uuid not null references public.referral_partner_locations(id) on delete cascade,
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  active boolean not null default true,
  priority integer not null default 100 check (priority >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, partner_location_id, postal_code)
);

create index referral_grocery_delivery_coverage_lookup_idx
  on public.referral_grocery_delivery_coverage
  (organization_id, postal_code, active, priority, partner_location_id);

create function public.referral_validate_grocery_coverage_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.referral_partner_locations location
    where location.id = new.partner_location_id
      and location.organization_id = new.organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'grocery_coverage_location_scope_mismatch';
  end if;
  return new;
end;
$$;

revoke all on function public.referral_validate_grocery_coverage_scope()
  from public, anon, authenticated;

create trigger referral_grocery_coverage_validate_scope
before insert or update of organization_id, partner_location_id
on public.referral_grocery_delivery_coverage
for each row execute function public.referral_validate_grocery_coverage_scope();

alter table public.referral_grocery_delivery_coverage enable row level security;
revoke all on table public.referral_grocery_delivery_coverage
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.referral_grocery_delivery_coverage to authenticated;
grant all on table public.referral_grocery_delivery_coverage to service_role;

create policy referral_grocery_coverage_operator_select
on public.referral_grocery_delivery_coverage
for select to authenticated
using (public.referral_is_member(organization_id, array['owner', 'admin']));

create policy referral_grocery_coverage_operator_insert
on public.referral_grocery_delivery_coverage
for insert to authenticated
with check (public.referral_is_member(organization_id, array['owner', 'admin']));

create policy referral_grocery_coverage_operator_update
on public.referral_grocery_delivery_coverage
for update to authenticated
using (public.referral_is_member(organization_id, array['owner', 'admin']))
with check (public.referral_is_member(organization_id, array['owner', 'admin']));

create policy referral_grocery_coverage_operator_delete
on public.referral_grocery_delivery_coverage
for delete to authenticated
using (public.referral_is_member(organization_id, array['owner', 'admin']));

insert into public.referral_grocery_delivery_coverage
  (organization_id, partner_location_id, postal_code, active, priority)
values
  ('luis-gabriel-referral-hub', '8bad61aa-3010-6cac-4f62-fd7cf16f35e2', '30345', true, 10),
  ('luis-gabriel-referral-hub', '8bad61aa-3010-6cac-4f62-fd7cf16f35e2', '30329', true, 10),
  ('luis-gabriel-referral-hub', '8bad61aa-3010-6cac-4f62-fd7cf16f35e2', '30341', true, 10),
  ('luis-gabriel-referral-hub', '5af97871-bb3e-5faf-45c9-701cd8d9a635', '30345', true, 20),
  ('luis-gabriel-referral-hub', '5af97871-bb3e-5faf-45c9-701cd8d9a635', '30329', true, 20),
  ('luis-gabriel-referral-hub', '5af97871-bb3e-5faf-45c9-701cd8d9a635', '30341', true, 20),
  ('luis-gabriel-referral-hub', '85ea7272-0d41-2d09-b29c-cc5c3320669e', '30315', true, 30),
  ('luis-gabriel-referral-hub', '7a000c5b-fd26-76f0-8bcd-08eecb72c769', '30345', true, 40),
  ('luis-gabriel-referral-hub', '7a000c5b-fd26-76f0-8bcd-08eecb72c769', '30071', true, 40),
  ('luis-gabriel-referral-hub', '7a000c5b-fd26-76f0-8bcd-08eecb72c769', '30044', true, 40),
  ('luis-gabriel-referral-hub', '014bb610-a915-e0ab-7c2c-a8a492e0c572', '30044', true, 50),
  ('luis-gabriel-referral-hub', '014bb610-a915-e0ab-7c2c-a8a492e0c572', '30071', true, 50),
  ('luis-gabriel-referral-hub', '8f1737f1-af9b-0630-6d97-011261ee5791', '30060', true, 60)
on conflict (organization_id, partner_location_id, postal_code)
do update set
  active = excluded.active,
  priority = excluded.priority,
  updated_at = now();

commit;
