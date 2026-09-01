-- Referral Hub operational-pilot post-migration verification.
-- READ ONLY: this file contains catalog inspection and SELECT statements only.
-- Expected execution point: after the two approved pilot migrations.
-- The deferred global org_members hardening migration is intentionally absent.

with
expected_tables(table_name) as (
  values
    ('referral_partner_contacts'),
    ('referral_partner_service_rules'),
    ('referral_service_requests'),
    ('referral_assignments'),
    ('referral_notification_attempts'),
    ('referral_operational_events'),
    ('referral_operational_exceptions'),
    ('referral_partner_access_tokens'),
    ('referral_conversation_operations'),
    ('referral_internal_notes'),
    ('referral_grocery_delivery_coverage')
),
expected_policies(table_name, policy_name) as (
  values
    ('referral_partner_contacts', 'referral_contacts_member_read'),
    ('referral_partner_service_rules', 'referral_rules_member_read'),
    ('referral_service_requests', 'referral_requests_member_read'),
    ('referral_assignments', 'referral_assignments_member_read'),
    ('referral_notification_attempts', 'referral_notifications_member_read'),
    ('referral_operational_events', 'referral_events_member_read'),
    ('referral_operational_exceptions', 'referral_exceptions_member_read'),
    ('referral_conversation_operations', 'referral_conversations_member_read'),
    ('referral_internal_notes', 'referral_notes_member_read'),
    ('referral_grocery_delivery_coverage', 'referral_grocery_coverage_operator_select'),
    ('referral_grocery_delivery_coverage', 'referral_grocery_coverage_operator_insert'),
    ('referral_grocery_delivery_coverage', 'referral_grocery_coverage_operator_update'),
    ('referral_grocery_delivery_coverage', 'referral_grocery_coverage_operator_delete')
),
existing_tables as (
  select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname in (select table_name from expected_tables)
),
existing_policies as (
  select tablename as table_name, policyname as policy_name
  from pg_policies
  where schemaname = 'public'
),
tenant_scope_mismatches as (
  select count(*)::bigint as mismatch_count
  from (
    select request.id
    from public.referral_service_requests request
    left join public.leads lead
      on lead.id = request.lead_id
     and lead.organization_id = request.organization_id
    where lead.id is null

    union all

    select assignment.id
    from public.referral_assignments assignment
    left join public.referral_service_requests request
      on request.id = assignment.request_id
     and request.organization_id = assignment.organization_id
    left join public.referral_partners partner
      on partner.id = assignment.partner_id
     and partner.organization_id = assignment.organization_id
    where request.id is null or partner.id is null

    union all

    select coverage.id
    from public.referral_grocery_delivery_coverage coverage
    left join public.referral_partner_locations location
      on location.id = coverage.partner_location_id
     and location.organization_id = coverage.organization_id
    where location.id is null
  ) mismatches
),
checks as (
  select
    '01_new_tables_exist'::text as check_name,
    count(existing_tables.table_name) = count(expected_tables.table_name) as passed,
    count(expected_tables.table_name)::text as expected,
    count(existing_tables.table_name)::text as actual
  from expected_tables
  left join existing_tables using (table_name)

  union all

  select
    '02_rls_enabled_on_new_tables',
    count(*) filter (where existing_tables.rls_enabled) = count(*),
    count(*)::text,
    count(*) filter (where existing_tables.rls_enabled)::text
  from expected_tables
  left join existing_tables using (table_name)

  union all

  select
    '03_expected_policies_exist',
    count(existing_policies.policy_name) = count(expected_policies.policy_name),
    count(expected_policies.policy_name)::text,
    count(existing_policies.policy_name)::text
  from expected_policies
  left join existing_policies using (table_name, policy_name)

  union all

  select
    '04_private_orchestration_rpc_exists',
    to_regprocedure(
      'public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb)'
    ) is not null,
    'present',
    case when to_regprocedure(
      'public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb)'
    ) is null then 'absent' else 'present' end

  union all

  select
    '05_orchestration_rpc_service_role_only',
    has_function_privilege(
      'service_role',
      'public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb)',
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb)',
      'execute'
    ),
    'service_role only',
    concat(
      'service_role=', has_function_privilege(
        'service_role',
        'public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb)',
        'execute'
      ),
      ', anon=', has_function_privilege(
        'anon',
        'public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb)',
        'execute'
      ),
      ', authenticated=', has_function_privilege(
        'authenticated',
        'public.orchestrate_referral_service_request(text,uuid,text,text,text,text,text,jsonb)',
        'execute'
      )
    )

  union all

  select
    '06_lg_grocery_coverage_rows',
    count(*) = 13,
    '13',
    count(*)::text
  from public.referral_grocery_delivery_coverage
  where organization_id = 'luis-gabriel-referral-hub'

  union all

  select
    '07_lg_covered_locations',
    count(distinct partner_location_id) = 6,
    '6',
    count(distinct partner_location_id)::text
  from public.referral_grocery_delivery_coverage
  where organization_id = 'luis-gabriel-referral-hub'

  union all

  select
    '08_coverage_backfill_has_no_other_tenant_rows',
    count(*) = 0,
    '0',
    count(*)::text
  from public.referral_grocery_delivery_coverage
  where organization_id <> 'luis-gabriel-referral-hub'

  union all

  select
    '09_no_cross_tenant_relationships',
    mismatch_count = 0,
    '0',
    mismatch_count::text
  from tenant_scope_mismatches

  union all

  select
    '10_partner_tokens_not_browser_granted',
    count(*) = 0,
    '0',
    count(*)::text
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'referral_partner_access_tokens'
    and grantee in ('anon', 'authenticated')

  union all

  select
    '11_service_role_operational_table_access',
    count(*) filter (
      where has_table_privilege(
        'service_role',
        format('public.%I', expected_tables.table_name),
        'SELECT,INSERT,UPDATE,DELETE'
      )
    ) = count(*),
    count(*)::text,
    count(*) filter (
      where has_table_privilege(
        'service_role',
        format('public.%I', expected_tables.table_name),
        'SELECT,INSERT,UPDATE,DELETE'
      )
    )::text
  from expected_tables
)
select check_name, passed, expected, actual
from checks
order by check_name;
