-- READ ONLY: partner identity and active status required by deterministic assignment.
select id, organization_id, name, active
from public.referral_partners
where organization_id = 'luis-gabriel-referral-hub'
order by id;
