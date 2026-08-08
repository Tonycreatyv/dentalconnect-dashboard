-- DEFERRED: explicitly excluded from the Referral Hub operational pilot.
-- Do not apply until browser membership bootstrap is replaced by a protected
-- server-side onboarding function and DentalConnect/BarberLine are validated.
-- Conservative legacy RLS hardening for the one confirmed unsafe write policy.
-- This migration intentionally does not alter leads/messages/demo policies: their
-- exact names and active product dependencies must be reviewed first so
-- DentalConnect and BarberLine browser flows are not disrupted.
begin;

-- The legacy policy allowed any authenticated user to insert an org membership
-- for any organization. Bootstrap/onboarding remains available to service_role,
-- which bypasses RLS. Existing owner/admin members may invite another member.
drop policy if exists org_members_insert on public.org_members;
revoke insert on table public.org_members from public, anon;

create policy org_members_insert_owner_admin
on public.org_members
for insert
to authenticated
with check (
  auth.uid() is not null
  and public.referral_is_member(
    org_members.organization_id,
    array['owner', 'admin']
  )
);

commit;
