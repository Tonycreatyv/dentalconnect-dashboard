-- READ ONLY: administrative roles used by the canonical tenant. No member PII.
select role, count(*) as member_count
from public.org_members
where organization_id = 'luis-gabriel-referral-hub'
group by role
order by role;
