-- SUPERSEDED — kept for historical reference only, do not apply this file.
-- Split (2026-08-24 activation-readiness audit) into four independently
-- reviewable/approvable files so each can be applied without waiting on
-- the others:
--   20260824_draft_A_business_identity_editing.sql
--   20260824_draft_B_coupon_editing.sql
--   20260824_draft_C_supermarket_location_media_editing.sql
--   20260824_draft_D_qr_entry_business_link_OPTIONAL.sql
-- The split also adds referral_partners.postal_code/image_url/faqs
-- (needed by the negocios/ frontend built after this file was written,
-- never added here) and referral_benefit_campaign_locations write RLS
-- (needed for the per-location supermarket image editor, entirely absent
-- from this file — Part C below never existed for that table).
--
-- DRAFT ONLY — NOT APPLIED. Do not run without explicit approval.
-- Placed outside supabase/migrations/ so it cannot be picked up by
-- `supabase db push`/migration tooling by accident.
--
-- Context: this makes referral_partners the single canonical "business"
-- entity and referral_coupon_campaigns the single canonical "coupon"
-- entity, per the approved business-centered redesign. It deliberately
-- does NOT create referral_businesses/referral_coupons/referral_campaigns
-- — every change below is an additive column, a new trigger, or a new RLS
-- policy on the three tables that already exist and are already read by
-- the live app and the live request_referral_benefit_claim RPC.
--
-- Explicitly out of scope, on purpose:
--   - the legacy `partners` table (unrelated to referral_partners) is not
--     touched.
--   - service_configs.partner_id is not repointed.
--   - service_configs RLS/grants are not touched (separate, already-flagged
--     security gap — needs its own cross-product consumer audit before any
--     fix; not bundled here).
--   - no data is backfilled by this file. Backfilling the real Médico
--     Urgencias/Dental Now 14/Ultra Cargo/supermarket rows from their
--     current hardcoded/table sources into referral_partners is a separate,
--     later, explicitly-approved step — this file only adds the columns
--     those rows will eventually populate.
--
-- ============================================================================
-- PART A: referral_partners becomes the canonical business entity
-- ============================================================================
begin;

alter table public.referral_partners
  add column if not exists category_service_id text null,
  add column if not exists contact_name text null,
  add column if not exists phone text null,
  add column if not exists address_text text null,
  add column if not exists hours jsonb not null default '{}'::jsonb,
  add column if not exists offers_coupon boolean not null default false,
  add column if not exists receives_service_requests boolean not null default false;

comment on column public.referral_partners.category_service_id is
  'The service catalog id this business belongs to (e.g. luis_benefit_medical). '
  'Free-text on purpose, matching the existing LuisServiceId string union — '
  'no separate services table exists to foreign-key against.';
comment on column public.referral_partners.hours is
  'Structured operating hours, shape left to the frontend (e.g. '
  '{"mon":{"open":"09:00","close":"18:00"}, ...}). Empty object means '
  '"not configured", not "closed".';
comment on column public.referral_partners.offers_coupon is
  'True if this business has (or should have) a row in '
  'referral_coupon_campaigns via business_id. Drives whether it appears '
  'under Cupones in the new /negocios UI.';
comment on column public.referral_partners.receives_service_requests is
  'True if this business receives referral_partner_service_rules-routed '
  'requests. Independent of offers_coupon — a business can be either, '
  'both, or (before configuration) neither.';

-- New write access: referral_partners currently has SELECT-only RLS
-- (referral_partners_member_select). Owner/admin write, mirroring the
-- existing referral_qr_entries_admin_insert/update pattern exactly.
create policy "referral_partners_admin_insert"
  on public.referral_partners for insert to authenticated
  with check (public.referral_is_member(organization_id, array['owner','admin']));

create policy "referral_partners_admin_update"
  on public.referral_partners for update to authenticated
  using (public.referral_is_member(organization_id, array['owner','admin']))
  with check (public.referral_is_member(organization_id, array['owner','admin']));

commit;

-- ============================================================================
-- PART B: referral_coupon_campaigns becomes the canonical coupon entity
-- ============================================================================
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
  'below), a ''legacy'' row may leave it null indefinitely.';
comment on column public.referral_coupon_campaigns.image_url is
  'HTTPS URL of the coupon image. Fallback-only for the supermarket '
  'benefit (its per-ZIP referral_benefit_campaign_locations.official_media_url '
  'always takes precedence when a location matches — see run-replies). '
  'Primary image source for non-location benefits once delivery_source=''db''.';
comment on column public.referral_coupon_campaigns.customer_copy is
  'The complete WhatsApp message body template (see '
  'supabase/functions/_shared/couponMessageTemplate.ts for the placeholder '
  'contract), used only when delivery_source=''db''. Not a fragment '
  'substituted into a fixed sentence — the whole message.';
comment on column public.referral_coupon_campaigns.terms_text is
  'Optional plain-text conditions, appended as its own line when non-empty '
  'and delivery_source=''db''. Never read for legacy rows.';
comment on column public.referral_coupon_campaigns.delivery_source is
  'Rollback switch. ''legacy'' (default): run-replies uses today''s exact '
  'hardcoded LUIS_BENEFITS[key] path, completely unaffected by any of the '
  'columns above. ''db'': run-replies uses business_id/image_url/'
  'customer_copy/terms_text instead. Flipping this one column is the '
  'entire cutover and the entire rollback — no redeploy either direction.';

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

create trigger referral_coupon_campaigns_business_same_org
  before insert or update of business_id, organization_id
  on public.referral_coupon_campaigns
  for each row execute function public.referral_assert_business_same_org();

-- New write access, mirroring referral_qr_entries_admin_insert/update.
create policy "referral_coupon_campaigns_admin_insert"
  on public.referral_coupon_campaigns for insert to authenticated
  with check (public.referral_is_member(organization_id, array['owner','admin']));

create policy "referral_coupon_campaigns_admin_update"
  on public.referral_coupon_campaigns for update to authenticated
  using (public.referral_is_member(organization_id, array['owner','admin']))
  with check (public.referral_is_member(organization_id, array['owner','admin']));

commit;

-- ============================================================================
-- PART C: referral_qr_entries gains a direct business pointer
-- ============================================================================
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

create trigger referral_qr_entries_business_same_org
  before insert or update of business_id, organization_id
  on public.referral_qr_entries
  for each row execute function public.referral_assert_business_same_org();

commit;
