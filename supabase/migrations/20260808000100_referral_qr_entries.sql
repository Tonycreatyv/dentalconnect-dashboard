-- Secure, opaque QR entry registry for Referral Hub. Public clients never read
-- this table directly; the Edge resolver validates a code with service access.
begin;

create extension if not exists pgcrypto;

create or replace function public.referral_generate_qr_public_code()
returns text
language sql
volatile
as $$
  select replace(replace(replace(encode(gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'), '=', '');
$$;

revoke all on function public.referral_generate_qr_public_code() from public, anon, authenticated;
grant execute on function public.referral_generate_qr_public_code() to authenticated, service_role;

create table if not exists public.referral_qr_entries (
  id uuid primary key default gen_random_uuid(),
  public_code text not null default public.referral_generate_qr_public_code(),
  organization_id text not null references public.organizations(id) on delete cascade,
  entry_type text not null,
  service_id text null,
  campaign_key text null,
  partner_location_id uuid null references public.referral_partner_locations(id) on delete restrict,
  active boolean not null default true,
  starts_at timestamptz null,
  expires_at timestamptz null,
  attribution_label text null,
  attribution_source text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_qr_entries_public_code_unique unique (public_code),
  constraint referral_qr_entries_public_code_format
    check (public_code ~ '^[A-Za-z0-9_-]{12,64}$'),
  constraint referral_qr_entries_type_check
    check (entry_type in ('general', 'service', 'campaign', 'location')),
  constraint referral_qr_entries_window_check
    check (expires_at is null or starts_at is null or expires_at > starts_at),
  constraint referral_qr_entries_attribution_length_check
    check (
      (attribution_label is null or length(attribution_label) <= 160)
      and (attribution_source is null or length(attribution_source) <= 120)
    ),
  constraint referral_qr_entries_context_check
    check (
      (entry_type = 'general' and service_id is null and campaign_key is null and partner_location_id is null)
      or (entry_type = 'service' and service_id is not null and campaign_key is null and partner_location_id is null)
      or (entry_type = 'campaign' and campaign_key is not null and service_id is null)
      or (entry_type = 'location' and partner_location_id is not null and not (service_id is not null and campaign_key is not null))
    ),
  constraint referral_qr_entries_campaign_scope_fk
    foreign key (organization_id, campaign_key)
    references public.referral_coupon_campaigns(organization_id, campaign_key)
    on update cascade on delete restrict
);

create index if not exists referral_qr_entries_dashboard_idx
  on public.referral_qr_entries (organization_id, active, created_at desc);

create or replace function public.referral_validate_qr_entry_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.service_id is not null and not exists (
    select 1 from public.service_configs service
    where service.id = new.service_id
      and service.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23503', message = 'qr_entry_service_scope_mismatch';
  end if;

  if new.partner_location_id is not null and not exists (
    select 1 from public.referral_partner_locations location
    where location.id = new.partner_location_id
      and location.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23503', message = 'qr_entry_location_scope_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function public.referral_validate_qr_entry_scope() from public, anon, authenticated;

create trigger referral_qr_entries_validate_scope
before insert or update of organization_id, service_id, campaign_key, partner_location_id
on public.referral_qr_entries
for each row execute function public.referral_validate_qr_entry_scope();

create or replace function public.referral_touch_qr_entry()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger referral_qr_entries_touch_updated_at
before update on public.referral_qr_entries
for each row execute function public.referral_touch_qr_entry();

alter table public.referral_qr_entries enable row level security;
revoke all on table public.referral_qr_entries from public, anon, authenticated;
grant select, insert, update, delete on table public.referral_qr_entries to authenticated;
grant all on table public.referral_qr_entries to service_role;

create policy referral_qr_entries_admin_select
on public.referral_qr_entries for select to authenticated
using (public.referral_is_member(organization_id, array['owner', 'admin']));

create policy referral_qr_entries_admin_insert
on public.referral_qr_entries for insert to authenticated
with check (public.referral_is_member(organization_id, array['owner', 'admin']));

create policy referral_qr_entries_admin_update
on public.referral_qr_entries for update to authenticated
using (public.referral_is_member(organization_id, array['owner', 'admin']))
with check (public.referral_is_member(organization_id, array['owner', 'admin']));

create policy referral_qr_entries_admin_delete
on public.referral_qr_entries for delete to authenticated
using (public.referral_is_member(organization_id, array['owner', 'admin']));

commit;
