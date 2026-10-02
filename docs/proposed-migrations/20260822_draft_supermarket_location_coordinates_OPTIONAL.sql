-- DRAFT ONLY — NOT APPLIED. OPTIONAL — the nearest-supermarket fallback
-- (supabase/functions/run-replies/domain/referralHub/nearestSupermarket.ts)
-- works correctly WITHOUT this migration: it geocodes each active
-- location's real address_text on demand via the Google Geocoding API on
-- every call. This migration only caches the result so a future version
-- doesn't re-geocode the same 3 store addresses on every unresolved-ZIP
-- customer interaction.
--
-- Mirrors the exact column convention already used elsewhere in this
-- schema for the same purpose (referral_partner_locations.latitude/
-- longitude/google_place_id, see 20260716-era migrations) rather than
-- inventing a new shape. Checked: the 3 real active supermarket locations
-- have partner_location_id = null (verified 2026-08-24) — there is no
-- existing referral_partner_locations row to reuse coordinates from, so
-- this genuinely needs its own columns on the canonical location table
-- (referral_benefit_campaign_locations), not a join to an existing one.
--
-- GOOGLE MAPS PLATFORM TERMS (2026-08-24 review — not legal advice; confirm
-- with counsel before relying on this for a compliance decision): place_id
-- may be cached indefinitely. Latitude/longitude derived from the
-- Geocoding API may be cached for up to 30 consecutive calendar days, after
-- which it must be deleted/refreshed — NOT stored forever. geocoded_at
-- below exists specifically to enforce that: application code (see
-- nearestSupermarket.ts) must treat a cached lat/lng as absent once
-- geocoded_at is more than 30 days old and re-geocode, not just read it
-- indefinitely. This column is a real correctness requirement of the
-- terms, not a nice-to-have.
--
-- Updated 2026-08-24: added geocoded_at (missing from the original draft).
begin;

alter table public.referral_benefit_campaign_locations
  add column if not exists latitude numeric(9,6) null,
  add column if not exists longitude numeric(9,6) null,
  add column if not exists google_place_id text null,
  add column if not exists geocoded_at timestamp with time zone null;

comment on column public.referral_benefit_campaign_locations.latitude is
  'Cached geocoded latitude of address_text. Nearest-supermarket matching
  treats this as absent (re-geocodes) whenever it is null OR geocoded_at
  is more than 30 days old, per Google Maps Platform''s caching terms for
  Geocoding API-derived lat/lng — never read indefinitely.';
comment on column public.referral_benefit_campaign_locations.longitude is
  'See latitude — same freshness rule, same column pair.';
comment on column public.referral_benefit_campaign_locations.google_place_id is
  'Google Place ID for this address. Place IDs may be cached indefinitely
  under Google Maps Platform''s terms (unlike lat/lng) — no freshness rule
  applies to this column.';
comment on column public.referral_benefit_campaign_locations.geocoded_at is
  'When latitude/longitude were last computed. NULL means never geocoded
  (or a prior cache was deliberately cleared). Application code must treat
  a value older than 30 days as stale and re-geocode rather than reuse it
  — see the Google Maps Platform terms note above.';

commit;
