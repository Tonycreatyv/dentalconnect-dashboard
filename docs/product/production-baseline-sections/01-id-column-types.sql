-- READ ONLY: types used by new foreign keys, membership authorization, and assignment.
select table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'organizations' and column_name = 'id') or
    (table_name = 'org_members' and column_name in ('organization_id', 'user_id', 'role')) or
    (table_name = 'leads' and column_name = 'id') or
    (table_name = 'referral_partners' and column_name in ('id', 'organization_id', 'active')) or
    (table_name = 'referral_partner_locations' and column_name in ('id', 'organization_id', 'partner_id'))
  )
order by table_name, ordinal_position;
