-- Review and apply independently only after explicit approval.
alter table public.org_settings
add column if not exists meta_page_name text;
