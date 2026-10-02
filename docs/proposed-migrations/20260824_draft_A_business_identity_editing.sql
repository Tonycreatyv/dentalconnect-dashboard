-- DRAFT ONLY — NOT APPLIED. Do not run without explicit approval.
-- Placed outside supabase/migrations/ so it cannot be picked up by
-- `supabase db push`/migration tooling by accident.
--
-- GATE 1-A (activation-readiness audit, 2026-08-24): the smallest change
-- that lets an owner/admin create a real business and edit its identity —
-- name, category, contact person, phone, address, postal code, hours,
-- an optional hero image, and up to 5 FAQs. Independent of Gate 1-B/1-C:
-- referral_coupon_campaigns.business_id (Gate 1-B) only needs
-- referral_partners.id, which already exists today — this file can be
-- applied before, after, or without Gate 1-B ever landing.
--
-- Idempotent: every ADD COLUMN uses IF NOT EXISTS; every CHECK constraint
-- and every CREATE POLICY is guarded with a DROP ... IF EXISTS immediately
-- before it (plain ADD CONSTRAINT has no IF NOT EXISTS form in Postgres,
-- so the drop-first guard is what makes it safe to re-run) so re-running
-- this file (e.g. after a partial failure) does not error on "already
-- exists". Safe against the live schema: referral_partners has none of
-- the columns below today, and its authenticated GRANT is SELECT-only
-- today (both verified fresh against `supabase db dump --linked` /
-- pg_catalog immediately before this preflight, 2026-08-24) — no naming
-- collisions, and the GRANT below is required, not optional: an RLS
-- policy alone cannot authorize a write Postgres's table-level GRANT
-- doesn't already permit (confirmed against the working reference,
-- referral_qr_entries, which has GRANT SELECT,INSERT,DELETE,UPDATE — the
-- same grant referral_partners is missing today).
--
-- Existing records: every new column is nullable or has a safe default,
-- so this never rewrites/breaks the 6 existing referral_partners rows
-- (all partnership_status='demo_reference' today). No backfill happens
-- here — a real Médico Urgencias/Dental Now 14/Ultra Cargo row is a
-- separate, later, explicitly-approved step.
--
-- Impact on run-replies: NONE. run-replies never reads referral_partners
-- today (confirmed by grep) — this file cannot change WhatsApp send
-- behavior even if applied immediately.
--
-- Rollback: `revoke insert, update on referral_partners from authenticated`,
-- `drop policy` the two new policies, `drop constraint` the two new CHECKs,
-- `alter table drop column` the eight new columns (all additive, no data
-- loss to anything else if rolled back — only the new columns' own data
-- is lost).
begin;

alter table public.referral_partners
  add column if not exists category_service_id text null,
  add column if not exists contact_name text null,
  add column if not exists phone text null,
  add column if not exists address_text text null,
  add column if not exists postal_code text null,
  add column if not exists image_url text null,
  add column if not exists hours jsonb not null default '{}'::jsonb,
  add column if not exists faqs jsonb not null default '[]'::jsonb,
  add column if not exists offers_coupon boolean not null default false,
  add column if not exists receives_service_requests boolean not null default false;

alter table public.referral_partners
  drop constraint if exists referral_partners_postal_code_check;
alter table public.referral_partners
  add constraint referral_partners_postal_code_check
  check (postal_code is null or postal_code ~ '^[0-9]{5}$');

alter table public.referral_partners
  drop constraint if exists referral_partners_image_url_check;
alter table public.referral_partners
  add constraint referral_partners_image_url_check
  check (image_url is null or image_url ~ '^https://');

comment on column public.referral_partners.category_service_id is
  'The service catalog id this business belongs to (e.g. luis_benefit_medical). '
  'Free-text on purpose, matching the existing LuisServiceId string union — '
  'no separate services table exists to foreign-key against.';
comment on column public.referral_partners.postal_code is
  'Business ZIP for display only — never consulted for supermarket
  location matching (that stays exclusively on
  referral_benefit_campaign_locations.postal_code, unaffected by this file).';
comment on column public.referral_partners.image_url is
  'Explicit business hero image. Precedence in the frontend (see
  src/apps/referral-hub/negocios/businessImage.ts): this field, then the
  business''s linked coupon image, then a neutral category icon — never a
  stock photo, never another business''s image.';
comment on column public.referral_partners.hours is
  'Structured operating hours, shape left to the frontend (e.g. '
  '{"mon":{"open":"09:00","close":"18:00"}, ...}). Empty object means '
  '"not configured", not "closed".';
comment on column public.referral_partners.faqs is
  'Up to 5 manually authored {question, answer} pairs, rendered verbatim —
  never a knowledge base, never LLM-answered. Count is enforced by the
  frontend only; not worth a DB-level array-length CHECK for this size.';
comment on column public.referral_partners.offers_coupon is
  'True if this business has (or should have) a row in '
  'referral_coupon_campaigns via business_id. Drives whether it appears '
  'under Cupones in the new /negocios UI.';
comment on column public.referral_partners.receives_service_requests is
  'True if this business receives referral_partner_service_rules-routed '
  'requests. Independent of offers_coupon — a business can be either, '
  'both, or (before configuration) neither.';

-- Table-level GRANT: referral_partners currently grants "authenticated"
-- SELECT only (confirmed via pg_catalog immediately before this file was
-- finalized). RLS policies cannot authorize an operation the table-level
-- GRANT doesn't already permit — without this, the INSERT/UPDATE policies
-- below would be silently inert (every write would fail with
-- "permission denied for table referral_partners" before RLS is even
-- evaluated). Matches the working reference exactly: referral_qr_entries
-- has GRANT SELECT,INSERT,DELETE,UPDATE — this file grants the same two
-- verbs referral_partners actually needs (no DELETE — no delete policy is
-- defined below, so a DELETE grant alone wouldn't be usable and isn't a
-- real product need here).
grant insert, update on table public.referral_partners to authenticated;

-- New write access: referral_partners currently has SELECT-only RLS
-- (referral_partners_member_select, member-level read). Owner/admin write,
-- mirroring the existing referral_qr_entries_admin_insert/update pattern
-- exactly (same referral_is_member(...) helper, same role list).
drop policy if exists "referral_partners_admin_insert" on public.referral_partners;
create policy "referral_partners_admin_insert"
  on public.referral_partners for insert to authenticated
  with check (public.referral_is_member(organization_id, array['owner','admin']));

drop policy if exists "referral_partners_admin_update" on public.referral_partners;
create policy "referral_partners_admin_update"
  on public.referral_partners for update to authenticated
  using (public.referral_is_member(organization_id, array['owner','admin']))
  with check (public.referral_is_member(organization_id, array['owner','admin']));

commit;
