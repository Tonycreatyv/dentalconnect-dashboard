-- DRAFT ONLY — NOT APPLIED. Do not run without explicit approval.
-- Placed outside supabase/migrations/ so it cannot be picked up by
-- `supabase db push`/migration tooling by accident.
--
-- GATE 1-C (activation-readiness audit, 2026-08-24): the smallest,
-- fully independent change of the three — no columns added, no FK to
-- referral_partners or referral_coupon_campaigns, touches exactly one
-- table. Lets an owner/admin edit ONE real supermarket location's
-- official_media_url (El Sol / Mi Tierra / El Güero today) — never the
-- shared campaign, never another location.
--
-- Why this didn't exist before: the original combined draft
-- (20260822_draft_business_coupon_canonical_fields.sql) never touched
-- referral_benefit_campaign_locations at all. Today that table has
-- exactly one policy — referral_benefit_locations_admin_read (SELECT,
-- owner/admin only) — confirmed via `supabase db dump --linked`,
-- 2026-08-24. No write policy of any kind exists. The frontend's
-- per-location image editor (src/apps/referral-hub/negocios/
-- CouponEditor.tsx "Ubicaciones participantes" section, and
-- RealNegociosDataSource.updateSupermarketLocation) currently writes only
-- to a session-local in-memory overlay for exactly this reason.
--
-- UPDATE-only, one column, this round (2026-08-24 preflight): confirmed
-- via information_schema that `authenticated` today has ONLY SELECT on
-- this table (no INSERT/UPDATE/DELETE) — same missing-GRANT defect class
-- as Gate 1-A/1-B, fixed the same way. Confirmed via CouponEditor.tsx that
-- the ONLY field the real, reviewed UI ever writes for a location is
-- official_media_url — no address/postal_code/display_name editing exists
-- in the app today. Per explicit scope for this round, INSERT is NOT
-- authorized (the original draft's insert policy is removed below — a
-- location row is never created through this app; the 3 real rows already
-- exist), and the UPDATE grant is deliberately column-level
-- (official_media_url only), not table-wide, so even a future frontend
-- bug cannot write address_text/postal_code/display_name/campaign_id
-- without a separate, explicit grant change.
--
-- Idempotent: DROP POLICY IF EXISTS guard before the CREATE POLICY. GRANT
-- is idempotent by nature.
--
-- Existing records: additive policy only, no column change, no row is
-- touched. The 3 real active locations and their real official_media_url
-- values are completely unaffected until an owner/admin explicitly edits
-- one through the app.
--
-- Impact on run-replies / claim delivery: NONE. request_referral_benefit_
-- claim and the nearest-supermarket confirmation path both SELECT
-- official_media_url at send time — whatever value is stored is what gets
-- sent, exactly as today; this migration only adds the ability for an
-- authorized human to change that value between sends. It does not
-- change WHICH location is selected for a given customer (ZIP-match /
-- nearest-store logic, entirely in request_referral_benefit_claim and
-- nearestSupermarket.ts, untouched by this file).
--
-- Rollback: revoke the column grant, drop the policy. No data loss beyond
-- reverting to read-only for this table.
begin;

-- Column-level GRANT — see header note. Deliberately narrower than
-- Gate 1-A/1-B's table-wide grants: only official_media_url, matching
-- exactly what the reviewed UI writes today.
grant update (official_media_url) on table public.referral_benefit_campaign_locations to authenticated;

-- Update only — no insert, no delete policy. INSERT is out of scope this
-- round (see header). Pausing a location is done via active=false
-- (already coverable by this update policy once a frontend control exists
-- for it — active is not column-restricted by the grant above, so add a
-- second column to the GRANT list if/when that control ships), not by
-- removing the row: both referral_benefit_claims.supermarket_location_id
-- and referral_benefit_claim_reroutes.{from,to}_supermarket_location_id
-- are ON DELETE RESTRICT (verified via `supabase db dump --linked`,
-- 2026-08-24), so Postgres itself would already refuse to delete a
-- location any real claim/reroute has ever referenced — a delete policy
-- would only be exercisable for a location with zero history, which isn't
-- a real product need here, so it's deliberately not offered.
drop policy if exists "referral_benefit_locations_admin_update" on public.referral_benefit_campaign_locations;
create policy "referral_benefit_locations_admin_update"
  on public.referral_benefit_campaign_locations for update to authenticated
  using (public.referral_is_member(organization_id, array['owner','admin']))
  with check (public.referral_is_member(organization_id, array['owner','admin']));

commit;
