-- DRAFT ONLY — NOT APPLIED. BLOCKED until explicitly approved AND the
-- bucket is provisioned by someone with Storage-admin access. This file
-- creates a bucket, which is a real infrastructure change (not covered by
-- the "additive column" reasoning that makes the other draft in this
-- folder low-risk) — do not run this without a separate, explicit go-ahead
-- even after the schema migration above is approved.
--
-- Purpose: lets an owner/admin upload a coupon image instead of pasting an
-- externally-hosted HTTPS URL into referral_coupon_campaigns.image_url (or,
-- since the 2026-08-24 audit, a supermarket location's official_media_url).
--
-- Updated 2026-08-24 (activation-readiness audit): StorageUploadField.tsx
-- IS now imported and rendered in CouponEditor.tsx (for both the regular
-- coupon image field and the per-location supermarket image editor) — but
-- it only ever produces a local blob: preview (URL.createObjectURL), never
-- an actual supabase.storage.upload() call, because no bucket exists.
-- Wiring the real upload call is separate frontend work, done only after
-- this bucket exists and Gate 1-B/1-C's write RLS is applied (uploading a
-- file nobody has permission to reference from image_url/official_media_url
-- would be pointless).
--
-- WhatsApp/Meta compatibility (confirmed via the WhatsApp Cloud API image
-- message contract): sending an image by URL requires a URL Meta's own
-- servers can fetch over plain HTTPS at send time, with no auth header
-- Meta would attach — the existing referral_benefit_campaign_locations.
-- official_media_url column already encodes this exact constraint via its
-- '^https://' CHECK. A Supabase Storage *signed* URL (time-limited,
-- opaque token) would work for a single send attempted immediately after
-- signing, but breaks for any resend/retry after the signature expires and
-- is not how any image is referenced anywhere else in this schema — a
-- PUBLIC bucket (as this file already does) is the correct choice, not a
-- gap to fix.
--
-- Recommended addition beyond the original draft: set bucket-level
-- file_size_limit and allowed_mime_types (Supabase Storage supports both
-- natively) so oversized/wrong-type files are rejected server-side, not
-- only by the frontend's imageValidation.ts (defense in depth — a client
-- can always be bypassed).
--
-- ============================================================================
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'referral-coupon-media', 'referral-coupon-media', true,
  5242880, -- 5 MB, matches src/apps/referral-hub/negocios/imageValidation.ts MAX_IMAGE_BYTES
  array['image/jpeg', 'image/png', 'image/webp'] -- matches ACCEPTED_IMAGE_TYPES in the same file
)
on conflict (id) do nothing;

-- Public read (coupon images are sent to customers over WhatsApp — they
-- must be fetchable by Meta's servers via a plain HTTPS URL, same
-- constraint referral_benefit_campaign_locations.official_media_url
-- already has via its "^https://" CHECK).
create policy "referral_coupon_media_public_read"
  on storage.objects for select
  using (bucket_id = 'referral-coupon-media');

-- Write restricted to owner/admin members of the organization encoded in
-- the object path (expected convention: "<organization_id>/coupons/<coupon_id>/<filename>"
-- for a shared coupon image, "<organization_id>/locations/<location_id>/<filename>"
-- for a single supermarket location's official image — both share this
-- one bucket/policy set since both are org-scoped by the same first path
-- segment; the coupons/locations subfolder is a frontend upload-path
-- convention only, not separately enforced here). Enforced by checking
-- the first path segment against org membership — mirrors the RLS pattern
-- used everywhere else in this draft rather than inventing a new
-- authorization shape.
create policy "referral_coupon_media_admin_write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'referral-coupon-media'
    and public.referral_is_member((storage.foldername(name))[1], array['owner','admin'])
  );

create policy "referral_coupon_media_admin_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'referral-coupon-media'
    and public.referral_is_member((storage.foldername(name))[1], array['owner','admin'])
  );

create policy "referral_coupon_media_admin_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'referral-coupon-media'
    and public.referral_is_member((storage.foldername(name))[1], array['owner','admin'])
  );

commit;
