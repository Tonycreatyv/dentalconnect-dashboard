-- DRAFT ONLY — NOT APPLIED. Do not run without explicit approval.
-- Placed outside supabase/migrations/ so it cannot be picked up by
-- `supabase db push`/migration tooling by accident.
--
-- GATE 1-B (activation-readiness audit, 2026-08-24): lets an owner/admin
-- associate a coupon with a business, edit its customer-facing WhatsApp
-- copy, conditions, image, expiration, and active/paused state.
-- Independent of Gate 1-A at the schema level (the business_id FK below
-- only needs referral_partners.id, which already exists) — this file can
-- be applied before, after, or without Gate 1-A. In practice both are
-- needed together for Luis to create a NEW business and immediately link
-- a coupon to it; an EXISTING referral_partners row (once one is ever
-- backfilled) can be linked with only this file applied.
--
-- Never touches the supermarket benefit's per-location image at all —
-- that stays exclusively on referral_benefit_campaign_locations
-- (Gate 1-C). image_url here is explicitly documented as fallback-only
-- for location-based benefits, primary only for medical/dental/shipping.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION, a
-- DROP CONSTRAINT IF EXISTS guard before the standalone CHECK constraint
-- (plain ADD CONSTRAINT has no IF NOT EXISTS form), and a DROP POLICY IF
-- EXISTS / DROP TRIGGER IF EXISTS guard before each CREATE POLICY /
-- CREATE TRIGGER (this project runs Postgres 17 per `supabase projects
-- list`, so CREATE OR REPLACE TRIGGER is actually available, but the
-- drop-first guard is used anyway for consistency with Gate 1-A/1-C).
--
-- GRANT required, same finding as Gate 1-A: referral_coupon_campaigns
-- currently grants "authenticated" SELECT only (confirmed fresh via
-- information_schema.role_table_grants, 2026-08-24) — without an explicit
-- INSERT/UPDATE GRANT, the two new RLS policies below would be silently
-- inert. Matches the working reference (referral_qr_entries) exactly.
--
-- Existing records/historical claims: additive-only, nullable/defaulted
-- columns. referral_benefit_claims rows are never touched by this file —
-- delivery_source only affects future run-replies reads of
-- referral_coupon_campaigns, never past claims.
--
-- Impact on run-replies: NONE until a) this migration is applied AND b)
-- the already-local (not yet deployed) run-replies changes that read
-- business_id/image_url/customer_copy/terms_text/delivery_source are also
-- deployed AND c) a specific coupon row's delivery_source is flipped to
-- 'db'. All three gates must be true; today none are.
--
-- Impact on existing medical/dental/shipping coupons: none by default —
-- delivery_source defaults to 'legacy', which is byte-for-byte identical
-- to today's hardcoded LUIS_BENEFITS[key] path (see
-- supabase/functions/run-replies/tests/couponMessageTemplateParity.test.ts,
-- the parity gate proving this).
--
-- Impact on supermarket location semantics: NONE — isSupermarket short-
-- circuits before any of these columns are ever consulted in run-replies
-- (see resolveCouponMediaUrl's isSupermarket branch); confirmed by
-- supabase/functions/run-replies/tests/couponImagePrecedence.test.ts.
--
-- Rollback: drop the two new policies, drop the trigger, drop the
-- function, drop the CHECK constraint, drop the five new columns.
begin;

alter table public.referral_coupon_campaigns
  add column if not exists business_id uuid null
    references public.referral_partners(id) on delete set null,
  add column if not exists image_url text null,
  add column if not exists customer_copy text null,
  add column if not exists terms_text text null,
  add column if not exists delivery_source text not null default 'legacy'
    constraint referral_coupon_campaigns_delivery_source_check
    check (delivery_source in ('legacy','db'));

comment on column public.referral_coupon_campaigns.business_id is
  'The business this coupon belongs to. Nullable during migration — a row '
  'with delivery_source=''db'' must have this set (enforced by the CHECK '
  'below), a ''legacy'' row may leave it null indefinitely. Always empty '
  'for the supermarket campaign (genuinely multi-location, never a single '
  'business) — see src/apps/referral-hub/negocios/realDataSource.ts.';
comment on column public.referral_coupon_campaigns.image_url is
  'HTTPS URL of the coupon image. NEVER consulted for the supermarket '
  'benefit at all — its per-ZIP referral_benefit_campaign_locations.'
  'official_media_url is the only image source that benefit ever uses. '
  'Primary image source for non-location benefits once delivery_source=''db''.';
comment on column public.referral_coupon_campaigns.customer_copy is
  'The complete WhatsApp message body template (see '
  'supabase/functions/_shared/couponMessageTemplate.ts for the placeholder '
  'contract), used only when delivery_source=''db''. Not a fragment '
  'substituted into a fixed sentence — the whole message. Never consulted '
  'for the supermarket benefit (see luisBenefits.ts comment: "Never '
  'consulted for SUPERMARKET at all").';
comment on column public.referral_coupon_campaigns.terms_text is
  'Optional plain-text conditions, appended as its own line when non-empty '
  'and delivery_source=''db''. Never read for legacy rows or for the '
  'supermarket benefit.';
comment on column public.referral_coupon_campaigns.delivery_source is
  'Rollback switch. ''legacy'' (default): run-replies uses today''s exact '
  'hardcoded LUIS_BENEFITS[key] path, completely unaffected by any of the '
  'columns above. ''db'': run-replies uses business_id/image_url/'
  'customer_copy/terms_text instead (non-supermarket benefits only — see '
  'above). Flipping this one column is the entire cutover and the entire '
  'rollback — no redeploy either direction.';

alter table public.referral_coupon_campaigns
  drop constraint if exists referral_coupon_campaigns_db_requires_business;
alter table public.referral_coupon_campaigns
  add constraint referral_coupon_campaigns_db_requires_business
  check (delivery_source <> 'db' or business_id is not null);

-- Organization isolation at the database level: a coupon's business_id, if
-- set, must belong to the same organization as the coupon itself. Postgres
-- foreign keys can't cross-check a second column, so this needs a trigger.
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

drop trigger if exists referral_coupon_campaigns_business_same_org on public.referral_coupon_campaigns;
create trigger referral_coupon_campaigns_business_same_org
  before insert or update of business_id, organization_id
  on public.referral_coupon_campaigns
  for each row execute function public.referral_assert_business_same_org();

-- Table-level GRANT — see header note. No DELETE (no delete policy is
-- defined below; pausing a coupon is `active=false`, covered by UPDATE).
grant insert, update on table public.referral_coupon_campaigns to authenticated;

-- New write access, mirroring referral_qr_entries_admin_insert/update.
drop policy if exists "referral_coupon_campaigns_admin_insert" on public.referral_coupon_campaigns;
create policy "referral_coupon_campaigns_admin_insert"
  on public.referral_coupon_campaigns for insert to authenticated
  with check (public.referral_is_member(organization_id, array['owner','admin']));

drop policy if exists "referral_coupon_campaigns_admin_update" on public.referral_coupon_campaigns;
create policy "referral_coupon_campaigns_admin_update"
  on public.referral_coupon_campaigns for update to authenticated
  using (public.referral_is_member(organization_id, array['owner','admin']))
  with check (public.referral_is_member(organization_id, array['owner','admin']));

commit;
