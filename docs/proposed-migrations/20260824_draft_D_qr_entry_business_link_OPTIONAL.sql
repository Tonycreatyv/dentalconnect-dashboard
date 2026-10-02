-- DRAFT ONLY — NOT APPLIED. Do not run without explicit approval.
-- Placed outside supabase/migrations/ so it cannot be picked up by
-- `supabase db push`/migration tooling by accident.
--
-- GATE 1-D, OPTIONAL — not required for any of the 15 items in Gate 1 of
-- the 2026-08-24 activation-readiness audit. Lets a referral_qr_entries
-- row (a flyer/QR campaign) point directly at a business. Independent of
-- A/B/C — only depends on referral_partners.id, which already exists.
-- Skip this file entirely until campaign-to-business linking is actually
-- requested; nothing in Gate 1 items 1-15 needs it.
begin;

alter table public.referral_qr_entries
  add column if not exists business_id uuid null
    references public.referral_partners(id) on delete set null;

comment on column public.referral_qr_entries.business_id is
  'A campaign/QR entry that promotes a business directly (as opposed to a '
  'service_id or campaign_key destination). Nullable, additive — existing '
  'entry_type union (general/service/campaign/location) and its CHECK '
  'constraint are unchanged; this is a new optional context column, not a '
  'new entry_type.';

-- Reuses the same org-isolation trigger function defined in
-- 20260824_draft_B_coupon_editing.sql (CREATE OR REPLACE — safe to define
-- again here if B was never applied; identical body either way).
create or replace function public.referral_assert_business_same_org()
returns trigger
language plpgsql
as $$
begin
  if new.business_id is not null then
    if not exists (
      select 1 from public.referral_partners p
      where p.id = new.business_id and p.organization_id = new.organization_id
    ) then
      raise exception 'business_organization_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists referral_qr_entries_business_same_org on public.referral_qr_entries;
create trigger referral_qr_entries_business_same_org
  before insert or update of business_id, organization_id
  on public.referral_qr_entries
  for each row execute function public.referral_assert_business_same_org();

commit;
