-- Add tester PSID gating for the #testdental override.
alter table if exists public.org_settings
  add column if not exists tester_psids jsonb not null default '[]';

update public.org_settings
set tester_psids = coalesce(tester_psids, '[]');

-- Replace the placeholder below with the real tester PSID seen in reply_outbox.channel_user_id.
update public.org_settings
set tester_psids = (coalesce(tester_psids, '[]'::jsonb) || '["REPLACE_WITH_TESTER_PSID"]'::jsonb)
where organization_id = 'creatyv-product'
  and not (tester_psids::text like '%REPLACE_WITH_TESTER_PSID%');
