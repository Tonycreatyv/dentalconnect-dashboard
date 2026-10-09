-- Problem: org_members_update allowed ANY member of an organization (any
-- role) to update ANY org_members row for that organization, including
-- their own role. In practice this meant a non-owner member could grant
-- themselves 'owner' (or change anyone else's role) via a direct client
-- call, with nothing at the database level to stop it - RLS was not
-- actually enforcing the owner/admin distinction it displays in the UI.
--
-- Fix: only an existing 'owner' of the organization may update org_members
-- rows for that organization (covers both which row is targeted and what
-- values are written, since Postgres reuses USING for UPDATE's WITH CHECK
-- when none is specified separately - made explicit here for clarity).
-- INSERT/SELECT policies are unchanged; org creation during onboarding
-- inserts the founder's own 'owner' row via the INSERT policy, never this
-- one.
drop policy if exists org_members_update on public.org_members;

create policy org_members_update on public.org_members
  for update
  using (
    exists (
      select 1 from public.org_members owner_check
      where owner_check.organization_id = org_members.organization_id
        and owner_check.user_id = auth.uid()
        and owner_check.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.org_members owner_check
      where owner_check.organization_id = org_members.organization_id
        and owner_check.user_id = auth.uid()
        and owner_check.role = 'owner'
    )
  );
