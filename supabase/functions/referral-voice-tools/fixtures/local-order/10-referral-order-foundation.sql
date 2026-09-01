begin;

-- This repository consumes this authorization helper but does not define it in
-- its local migrations. Fail before creating any objects if the target schema
-- does not expose the exact contract required by the RLS policies below.
do $$
declare
  helper_oid oid := to_regprocedure('public.user_belongs_to_org(text)');
  helper_return_type regtype;
  helper_is_security_definer boolean;
  helper_settings text[];
  helper_has_safe_search_path boolean;
  organizations_table regclass := to_regclass('public.organizations');
  organization_id_type regtype;
begin
  if organizations_table is null then
    raise exception 'Missing dependency: public.organizations';
  end if;

  select atttypid::regtype
    into organization_id_type
    from pg_attribute
   where attrelid = organizations_table
     and attname = 'id'
     and attnum > 0
     and not attisdropped;

  if organization_id_type is null or organization_id_type <> 'text'::regtype then
    raise exception 'Invalid dependency: public.organizations.id must use text';
  end if;

  if helper_oid is null then
    raise exception using
      errcode = '42883',
      message = 'Missing dependency: public.user_belongs_to_org(text)',
      hint = 'Verify the shared authorization infrastructure before applying this migration.';
  end if;

  select prorettype::regtype, prosecdef, proconfig
    into helper_return_type, helper_is_security_definer, helper_settings
    from pg_proc
   where oid = helper_oid;

  if helper_return_type <> 'boolean'::regtype then
    raise exception 'Invalid dependency: public.user_belongs_to_org(text) must return boolean';
  end if;

  if not helper_is_security_definer then
    raise exception 'Invalid dependency: public.user_belongs_to_org(text) must be SECURITY DEFINER';
  end if;

  select coalesce(bool_or(
    lower(regexp_replace(setting, '\s', '', 'g')) in (
      'search_path=public,pg_temp',
      'search_path=pg_temp,public'
    )
  ), false)
    into helper_has_safe_search_path
    from unnest(coalesce(helper_settings, array[]::text[])) as settings(setting);

  if not helper_has_safe_search_path then
    raise exception 'Invalid dependency: public.user_belongs_to_org(text) must set search_path to public, pg_temp';
  end if;

  if not has_function_privilege('authenticated', helper_oid, 'EXECUTE') then
    raise exception 'Invalid dependency: authenticated must be able to execute public.user_belongs_to_org(text)';
  end if;

  if not coalesce((select rolbypassrls from pg_roles where rolname = 'service_role'), false) then
    raise exception 'Invalid dependency: service_role must have BYPASSRLS';
  end if;

  if to_regprocedure('gen_random_uuid()') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'Missing dependency: pgcrypto random functions';
  end if;
end;
$$;

create table public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  partnership_status text not null default 'demo_reference'
    check (partnership_status in ('demo_reference', 'pending', 'active', 'paused', 'ended')),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, slug)
);

create table public.referral_partner_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  partner_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  formatted_address text not null check (length(trim(formatted_address)) > 0),
  city text not null check (length(trim(city)) > 0),
  state text not null check (length(trim(state)) > 0),
  postal_code text not null check (length(trim(postal_code)) > 0),
  country_code text not null default 'US' check (country_code ~ '^[A-Z]{2}$'),
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  google_place_id text,
  delivery_enabled boolean not null default false,
  pickup_enabled boolean not null default false,
  minimum_order_cents integer not null default 0 check (minimum_order_cents >= 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, partner_id, id),
  foreign key (organization_id, partner_id)
    references public.referral_partners(organization_id, id) on delete restrict
);

create table public.referral_basket_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  partner_location_id uuid not null,
  basket_key text not null check (basket_key in ('essential', 'family', 'complete')),
  display_name text not null check (length(trim(display_name)) > 0),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  contents_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, partner_location_id, id),
  foreign key (organization_id, partner_location_id)
    references public.referral_partner_locations(organization_id, id) on delete restrict
);

create unique index referral_basket_offers_active_key_idx
  on public.referral_basket_offers (organization_id, partner_location_id, basket_key)
  where active;

create table public.referral_delivery_fee_bands (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  partner_location_id uuid not null,
  min_distance_miles numeric(8, 2) not null check (min_distance_miles >= 0),
  max_distance_miles numeric(8, 2) not null,
  fee_cents integer not null check (fee_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, partner_location_id, id),
  check (max_distance_miles > min_distance_miles),
  foreign key (organization_id, partner_location_id)
    references public.referral_partner_locations(organization_id, id) on delete restrict
);

create table public.referral_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete restrict,
  order_code text not null unique
    check (order_code ~ '^RH-ATL-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$'),
  idempotency_key text not null
    check (idempotency_key = trim(idempotency_key) and length(idempotency_key) between 8 and 200),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'awaiting_partner_confirmation', 'confirmed', 'preparing', 'out_for_delivery', 'completed', 'cancelled')),
  campaign_code text,
  source_channel text not null check (source_channel in ('web', 'whatsapp', 'qr', 'admin')),
  source_reference text,

  customer_name text not null check (length(trim(customer_name)) > 0),
  customer_phone text not null check (length(trim(customer_phone)) > 0),
  customer_email text,

  partner_id uuid not null,
  partner_location_id uuid not null,
  partner_name_snapshot text not null check (length(trim(partner_name_snapshot)) > 0),
  partner_location_name_snapshot text not null check (length(trim(partner_location_name_snapshot)) > 0),
  partner_address_snapshot text not null check (length(trim(partner_address_snapshot)) > 0),

  basket_offer_id uuid not null,
  basket_key text not null check (basket_key in ('essential', 'family', 'complete')),
  basket_name_snapshot text not null check (length(trim(basket_name_snapshot)) > 0),
  basket_price_cents integer not null check (basket_price_cents >= 0),
  basket_contents_snapshot jsonb not null default '[]'::jsonb,

  delivery_address text not null check (length(trim(delivery_address)) > 0),
  delivery_city text not null check (length(trim(delivery_city)) > 0),
  delivery_state text not null check (length(trim(delivery_state)) > 0),
  delivery_postal_code text not null check (length(trim(delivery_postal_code)) > 0),
  delivery_country_code text not null default 'US' check (delivery_country_code ~ '^[A-Z]{2}$'),
  delivery_latitude numeric(9, 6) not null check (delivery_latitude between -90 and 90),
  delivery_longitude numeric(9, 6) not null check (delivery_longitude between -180 and 180),
  delivery_distance_miles numeric(8, 2) check (delivery_distance_miles is null or delivery_distance_miles >= 0),
  delivery_duration_minutes integer check (delivery_duration_minutes is null or delivery_duration_minutes >= 0),
  delivery_fee_band_id uuid,
  delivery_fee_cents integer not null check (delivery_fee_cents >= 0),
  route_source text not null check (route_source in ('demo', 'google_routes', 'manual')),
  coverage_status text not null check (coverage_status in ('available', 'manual_review', 'unavailable')),

  subtotal_cents integer not null check (subtotal_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),

  customer_notes text,
  consent_transactional boolean not null default false,
  consent_marketing boolean not null default false,
  consent_version text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  check (total_cents = subtotal_cents + delivery_fee_cents),
  check (status = 'draft' or submitted_at is not null),
  foreign key (organization_id, partner_id)
    references public.referral_partners(organization_id, id) on delete restrict,
  foreign key (organization_id, partner_id, partner_location_id)
    references public.referral_partner_locations(organization_id, partner_id, id) on delete restrict,
  foreign key (organization_id, partner_location_id, basket_offer_id)
    references public.referral_basket_offers(organization_id, partner_location_id, id) on delete restrict,
  foreign key (organization_id, partner_location_id, delivery_fee_band_id)
    references public.referral_delivery_fee_bands(organization_id, partner_location_id, id) on delete restrict
);

create table public.referral_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete restrict,
  order_id uuid not null,
  item_type text not null check (item_type in ('basket', 'product', 'fee', 'adjustment')),
  item_reference_id uuid,
  sku text,
  name_snapshot text not null check (length(trim(name_snapshot)) > 0),
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  total_price_cents integer not null check (total_price_cents >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  check (total_price_cents = quantity * unit_price_cents),
  foreign key (organization_id, order_id)
    references public.referral_orders(organization_id, id) on delete cascade
);

create table public.referral_order_status_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete restrict,
  order_id uuid not null,
  from_status text check (from_status is null or from_status in ('draft', 'submitted', 'awaiting_partner_confirmation', 'confirmed', 'preparing', 'out_for_delivery', 'completed', 'cancelled')),
  to_status text not null check (to_status in ('draft', 'submitted', 'awaiting_partner_confirmation', 'confirmed', 'preparing', 'out_for_delivery', 'completed', 'cancelled')),
  actor_type text not null check (actor_type in ('customer', 'staff', 'system', 'partner', 'whatsapp')),
  actor_id uuid,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, order_id)
    references public.referral_orders(organization_id, id) on delete cascade
);

create index referral_partners_org_active_idx
  on public.referral_partners (organization_id, active, name);
create index referral_partner_locations_org_active_idx
  on public.referral_partner_locations (organization_id, active, postal_code);
create index referral_partner_locations_partner_idx
  on public.referral_partner_locations (organization_id, partner_id);
create index referral_basket_offers_location_idx
  on public.referral_basket_offers (organization_id, partner_location_id, active);
create index referral_delivery_fee_bands_location_idx
  on public.referral_delivery_fee_bands (organization_id, partner_location_id, active, min_distance_miles);
create index referral_orders_org_status_created_idx
  on public.referral_orders (organization_id, status, created_at desc);
create index referral_orders_partner_location_idx
  on public.referral_orders (organization_id, partner_location_id, created_at desc);
create index referral_orders_partner_idx
  on public.referral_orders (organization_id, partner_id, created_at desc);
create index referral_orders_basket_offer_idx
  on public.referral_orders (organization_id, basket_offer_id);
create index referral_orders_created_at_idx
  on public.referral_orders (created_at desc);
create index referral_order_items_order_idx
  on public.referral_order_items (organization_id, order_id);
create index referral_order_status_events_order_idx
  on public.referral_order_status_events (organization_id, order_id, created_at);

create or replace function public.set_referral_order_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger referral_partners_updated_at
before update on public.referral_partners
for each row execute function public.set_referral_order_updated_at();
create trigger referral_partner_locations_updated_at
before update on public.referral_partner_locations
for each row execute function public.set_referral_order_updated_at();
create trigger referral_basket_offers_updated_at
before update on public.referral_basket_offers
for each row execute function public.set_referral_order_updated_at();
create trigger referral_delivery_fee_bands_updated_at
before update on public.referral_delivery_fee_bands
for each row execute function public.set_referral_order_updated_at();
create trigger referral_orders_updated_at
before update on public.referral_orders
for each row execute function public.set_referral_order_updated_at();

create or replace function public.generate_referral_order_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  random_bytes bytea;
begin
  for attempt in 1..20 loop
    random_bytes := extensions.gen_random_bytes(5);
    candidate := 'RH-ATL-';
    for position in 0..4 loop
      candidate := candidate || substr(alphabet, (get_byte(random_bytes, position) % length(alphabet)) + 1, 1);
    end loop;
    if not exists (select 1 from public.referral_orders where order_code = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'could_not_generate_unique_referral_order_code';
end;
$$;

alter table public.referral_orders
  alter column order_code set default public.generate_referral_order_code();

alter table public.referral_partners enable row level security;
alter table public.referral_partner_locations enable row level security;
alter table public.referral_basket_offers enable row level security;
alter table public.referral_delivery_fee_bands enable row level security;
alter table public.referral_orders enable row level security;
alter table public.referral_order_items enable row level security;
alter table public.referral_order_status_events enable row level security;

revoke all on public.referral_partners from anon, authenticated;
revoke all on public.referral_partner_locations from anon, authenticated;
revoke all on public.referral_basket_offers from anon, authenticated;
revoke all on public.referral_delivery_fee_bands from anon, authenticated;
revoke all on public.referral_orders from anon, authenticated;
revoke all on public.referral_order_items from anon, authenticated;
revoke all on public.referral_order_status_events from anon, authenticated;

grant select on public.referral_partners to authenticated;
grant select on public.referral_partner_locations to authenticated;
grant select on public.referral_basket_offers to authenticated;
grant select on public.referral_delivery_fee_bands to authenticated;
grant select on public.referral_orders to authenticated;
grant select on public.referral_order_items to authenticated;
grant select on public.referral_order_status_events to authenticated;

grant all on public.referral_partners to service_role;
grant all on public.referral_partner_locations to service_role;
grant all on public.referral_basket_offers to service_role;
grant all on public.referral_delivery_fee_bands to service_role;
grant all on public.referral_orders to service_role;
grant all on public.referral_order_items to service_role;
grant all on public.referral_order_status_events to service_role;

create policy referral_partners_member_select
  on public.referral_partners for select to authenticated
  using (public.user_belongs_to_org(organization_id));
create policy referral_partner_locations_member_select
  on public.referral_partner_locations for select to authenticated
  using (public.user_belongs_to_org(organization_id));
create policy referral_basket_offers_member_select
  on public.referral_basket_offers for select to authenticated
  using (public.user_belongs_to_org(organization_id));
create policy referral_delivery_fee_bands_member_select
  on public.referral_delivery_fee_bands for select to authenticated
  using (public.user_belongs_to_org(organization_id));
create policy referral_orders_member_select
  on public.referral_orders for select to authenticated
  using (public.user_belongs_to_org(organization_id));
create policy referral_order_items_member_select
  on public.referral_order_items for select to authenticated
  using (public.user_belongs_to_org(organization_id));
create policy referral_order_status_events_member_select
  on public.referral_order_status_events for select to authenticated
  using (public.user_belongs_to_org(organization_id));

revoke all on function public.generate_referral_order_code() from public, anon, authenticated;
grant execute on function public.generate_referral_order_code() to service_role;
revoke all on function public.set_referral_order_updated_at() from public, anon, authenticated;
grant execute on function public.set_referral_order_updated_at() to service_role;

commit;
