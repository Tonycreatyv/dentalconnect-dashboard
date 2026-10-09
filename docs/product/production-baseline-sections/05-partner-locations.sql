-- READ ONLY: location ownership and non-customer service geography.
select id,
       organization_id,
       partner_id,
       name,
       active,
       delivery_enabled,
       city,
       state,
       postal_code
from public.referral_partner_locations
where organization_id = 'luis-gabriel-referral-hub'
order by partner_id, id;
