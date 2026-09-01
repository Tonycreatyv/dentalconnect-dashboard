-- READ ONLY. Remaining production facts required before applying the
-- Referral Hub operational migration or deploying its dependent functions.
-- referral_basket_offers UUIDs, organization scope, location scope, logical
-- basket keys, location-specific prices, currency, and active rows are already
-- confirmed and therefore are not queried again here.

-- 1. Types used by new foreign keys, membership authorization, and assignment.
select table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'organizations' and column_name = 'id') or
    (table_name = 'org_members' and column_name in ('organization_id','user_id','role')) or
    (table_name = 'leads' and column_name = 'id') or
    (table_name = 'referral_partners' and column_name in ('id','organization_id','active')) or
    (table_name = 'referral_partner_locations' and column_name in ('id','organization_id','partner_id'))
  )
order by table_name, ordinal_position;

-- 2. Existing PK/unique/FK definitions on tables referenced by the migration.
select conrelid::regclass::text as table_name,
       conname,
       contype,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in (
    'organizations','org_members','leads',
    'referral_partners','referral_partner_locations'
  )
order by table_name, conname;

-- 3. Actual administrative roles used by the canonical tenant. No PII.
select role, count(*) as member_count
from public.org_members
where organization_id = 'luis-gabriel-referral-hub'
group by role
order by role;

-- 4. Partner columns and location ownership needed by deterministic assignment.
select id, organization_id, name, active
from public.referral_partners
where organization_id = 'luis-gabriel-referral-hub'
order by id;

select id, organization_id, partner_id, name, active, delivery_enabled,
       city, state, postal_code
from public.referral_partner_locations
where organization_id = 'luis-gabriel-referral-hub'
order by partner_id, id;

-- 5. RLS still required for browser-read surfaces. Basket rows are included
-- only for policy inspection; their data/type facts must not be re-queried.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'org_members','leads','messages','service_configs','referral_partners',
    'referral_partner_locations','referral_basket_offers',
    'referral_orders','referral_order_status_events'
  )
order by tablename, policyname;

-- 6. Existing order RPC identities and return types. The backend must continue
-- resolving the persisted offer UUID and price; the browser never supplies price.
select n.nspname as schema_name,
       p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_referral_order','update_referral_order_status')
order by p.proname;

-- 7. Runtime content snapshot compatibility, the one offer column not covered
-- by the confirmed result set but used to render basket contents.
select table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'referral_basket_offers'
  and column_name = 'contents_snapshot';
