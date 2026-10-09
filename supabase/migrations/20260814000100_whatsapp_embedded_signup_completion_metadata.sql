-- Stores only non-secret Embedded Signup completion metadata for future audits.
-- This migration intentionally does not modify any existing organization row.
alter table public.org_settings
  add column if not exists whatsapp_onboarding_event text,
  add column if not exists whatsapp_onboarding_mode text,
  add column if not exists whatsapp_session_info_version text,
  add column if not exists whatsapp_business_app_coexistence_completed boolean;

alter table public.org_settings
  drop constraint if exists org_settings_whatsapp_onboarding_mode_check;

alter table public.org_settings
  add constraint org_settings_whatsapp_onboarding_mode_check
  check (
    whatsapp_onboarding_mode is null or
    whatsapp_onboarding_mode in ('STANDARD', 'COEXISTENCE')
  );
