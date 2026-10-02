-- Reconstructed from the live production schema on 2026-10-02.
-- This migration version already exists in production history.

alter table public.service_configs
  add column if not exists requires_authorization boolean not null default false;

alter table public.referral_partner_service_rules
  add column if not exists starts_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists workspace_config jsonb not null default '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.referral_workspace_config_is_valid(p_config jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  value jsonb;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    return false;
  end if;

  if p_config ? 'display_name' then
    value := p_config->'display_name';
    if jsonb_typeof(value) <> 'string' or length(trim(value #>> '{}')) = 0 or length(value #>> '{}') > 160 then
      return false;
    end if;
  end if;

  foreach value in array array[
    p_config->'visible_columns',
    p_config->'column_order',
    p_config->'service_fields'
  ] loop
    if value is not null then
      if jsonb_typeof(value) <> 'array'
        or exists (
          select 1
          from jsonb_array_elements(value) as item
          where jsonb_typeof(item) <> 'string'
             or length(trim(item #>> '{}')) = 0
             or length(item #>> '{}') > 128
        )
        or exists (
          select 1 from jsonb_array_elements_text(value) as item
          group by item having count(*) > 1
        ) then
        return false;
      end if;
    end if;
  end loop;

  if p_config ? 'default_filters'
    and jsonb_typeof(p_config->'default_filters') <> 'object' then
    return false;
  end if;

  if p_config ? 'export_enabled'
    and jsonb_typeof(p_config->'export_enabled') <> 'boolean' then
    return false;
  end if;

  if p_config ? 'allowed_actions' then
    value := p_config->'allowed_actions';
    if jsonb_typeof(value) <> 'array'
      or exists (
        select 1
        from jsonb_array_elements_text(value) as item
        where item not in (
          'accept', 'reject', 'contacted', 'no_answer', 'appointment_scheduled',
          'converted', 'closed_not_converted', 'note', 'follow_up', 'correct_result',
          'call', 'whatsapp'
        )
      )
      or exists (
        select 1 from jsonb_array_elements_text(value) as item
        group by item having count(*) > 1
      ) then
      return false;
    end if;
  end if;

  -- Unknown keys are intentionally allowed for future, backward-compatible
  -- workspace metadata. Known keys above are validated before a portal uses them.
  return true;
end;
$function$
;

alter table public.referral_partner_service_rules
  drop constraint if exists referral_partner_service_rules_valid_window;
alter table public.referral_partner_service_rules
  add constraint referral_partner_service_rules_valid_window
  check (expires_at is null or starts_at is null or expires_at > starts_at);

alter table public.referral_partner_service_rules
  drop constraint if exists referral_partner_service_rules_workspace_config_valid;
alter table public.referral_partner_service_rules
  add constraint referral_partner_service_rules_workspace_config_valid
  check (public.referral_workspace_config_is_valid(workspace_config));

-- Production authorization semantics for the Luis Referral Hub.
update public.service_configs
set requires_authorization = true
where organization_id = 'luis-gabriel-referral-hub'
  and id in ('luis_inmigracion','luis_accidente','luis_dui_criminal');

update public.service_configs
set requires_authorization = false
where organization_id = 'luis-gabriel-referral-hub'
  and id in (
    'luis_compra_super','luis_cupon_dental','luis_cupon_medico','luis_cupon_super',
    'luis_eventos','luis_muebles','luis_representante'
  );
