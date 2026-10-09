-- READ ONLY: one result table containing only the remaining security, fee,
-- grant, and organization-resolution unknowns. All six current LG locations
-- are already confirmed to have latitude and longitude populated.
with findings as (
  select 'fee_band_columns'::text as section,
         coalesce(jsonb_agg(jsonb_build_object(
           'column_name', column_name,
           'data_type', data_type,
           'udt_name', udt_name,
           'is_nullable', is_nullable
         ) order by ordinal_position), '[]'::jsonb) as result
  from information_schema.columns
  where table_schema='public' and table_name='referral_delivery_fee_bands'

  union all
  select 'fee_band_constraints',
         coalesce(jsonb_agg(jsonb_build_object(
           'name', conname,
           'type', contype,
           'definition', pg_get_constraintdef(oid)
         ) order by conname), '[]'::jsonb)
  from pg_constraint
  where connamespace='public'::regnamespace
    and conrelid='public.referral_delivery_fee_bands'::regclass

  union all
  select 'fee_band_rls_policies',
         coalesce(jsonb_agg(jsonb_build_object(
           'policyname', policyname,
           'roles', roles,
           'cmd', cmd,
           'qual', qual,
           'with_check', with_check
         ) order by policyname), '[]'::jsonb)
  from pg_policies
  where schemaname='public' and tablename='referral_delivery_fee_bands'

  union all
  select 'lg_fee_band_rows_without_pii',
         coalesce(jsonb_agg(to_jsonb(fee_band) - 'created_by' - 'updated_by' order by fee_band.id), '[]'::jsonb)
  from public.referral_delivery_fee_bands fee_band
  where fee_band.organization_id='luis-gabriel-referral-hub'

  union all
  select 'order_rpc_grants',
         coalesce(jsonb_agg(jsonb_build_object(
           'routine_name', routine_name,
           'grantee', grantee,
           'privilege_type', privilege_type
         ) order by routine_name,grantee), '[]'::jsonb)
  from information_schema.routine_privileges
  where specific_schema='public'
    and routine_name in ('create_referral_order','update_referral_order_status')

  union all
  select 'rls_enabled_and_forced',
         coalesce(jsonb_agg(jsonb_build_object(
           'table_name', c.relname,
           'rls_enabled', c.relrowsecurity,
           'rls_forced', c.relforcerowsecurity
         ) order by c.relname), '[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (
    'org_members','leads','messages','service_configs','referral_partners',
    'referral_partner_locations','referral_basket_offers','referral_orders',
    'referral_order_status_events','referral_delivery_fee_bands'
  )

  union all
  select 'organization_helper_definitions',
         coalesce(jsonb_agg(jsonb_build_object(
           'name', p.proname,
           'arguments', pg_get_function_identity_arguments(p.oid),
           'security_definer', p.prosecdef,
           'definition', pg_get_functiondef(p.oid)
         ) order by p.proname), '[]'::jsonb)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in ('user_belongs_to_org','org_has_access','current_org_id','user_org_ids')

  union all
  select 'profiles_organization_policies',
         coalesce(jsonb_agg(jsonb_build_object(
           'policyname', policyname,
           'roles', roles,
           'cmd', cmd,
           'qual', qual,
           'with_check', with_check
         ) order by policyname), '[]'::jsonb)
  from pg_policies
  where schemaname='public' and tablename='profiles'
)
select section,result from findings order by section;
