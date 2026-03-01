alter table public.org_secrets
  add column if not exists "META_PAGE_ACCESS_TOKEN" text;
