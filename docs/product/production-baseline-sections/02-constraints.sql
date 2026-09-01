-- READ ONLY: existing PK, unique, and FK definitions referenced by the migration.
select conrelid::regclass::text as table_name,
       conname,
       contype,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in (
    'organizations',
    'org_members',
    'leads',
    'referral_partners',
    'referral_partner_locations'
  )
order by table_name, conname;
