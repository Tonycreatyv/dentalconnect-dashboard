-- ConeXXion V2 focused database hardening.
-- Repository-only until final production review.

alter function public.referral_assert_business_same_org()
  set search_path = public, pg_temp;

alter function public.referral_generate_qr_public_code()
  set search_path = public, pg_temp;

alter function public.referral_touch_qr_entry()
  set search_path = public, pg_temp;

-- Partner Portal reads by partner_id ordered by assigned_at and RLS also
-- evaluates organization scope. This index supports that hot path and the
-- composite partner FK without introducing a broad indexing sweep.
create index if not exists referral_assignments_partner_queue_v2_idx
  on public.referral_assignments (partner_id, organization_id, assigned_at desc);

-- Admin/customer detail reads cases by lead + organization ordered newest
-- first. Leading with lead_id also covers the existing lead FK efficiently.
create index if not exists referral_service_requests_lead_timeline_v2_idx
  on public.referral_service_requests (lead_id, organization_id, created_at desc);
