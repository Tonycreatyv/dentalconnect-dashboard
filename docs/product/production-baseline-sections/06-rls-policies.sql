-- READ ONLY: RLS policies for browser-read operational surfaces.
-- Basket offers are included only for policy inspection, not data inspection.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'org_members',
    'leads',
    'messages',
    'service_configs',
    'referral_partners',
    'referral_partner_locations',
    'referral_basket_offers',
    'referral_orders',
    'referral_order_status_events'
  )
order by tablename, policyname;
