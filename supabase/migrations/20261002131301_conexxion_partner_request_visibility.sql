-- ConeXXion V2: partner request visibility follows assignment + consent,
-- not a hard-coded service allowlist.
--
-- Repository-only migration until final review. This replaces the current
-- service-specific request read policies for partner users.

drop policy if exists referral_requests_partner_authorized_read
  on public.referral_service_requests;

drop policy if exists referral_requests_partner_authorized_read_legal
  on public.referral_service_requests;

create policy referral_requests_partner_assigned_authorized_read
on public.referral_service_requests
for select
to authenticated
using (
  coalesce(consent ->> 'status', 'pending_review') = 'authorized'
  and exists (
    select 1
    from public.referral_assignments a
    where a.request_id = referral_service_requests.id
      and a.organization_id = referral_service_requests.organization_id
      and a.status in ('pending_assignment', 'assigned', 'accepted')
      and public.referral_is_active_partner_member(
        a.organization_id,
        a.partner_id
      )
  )
);
