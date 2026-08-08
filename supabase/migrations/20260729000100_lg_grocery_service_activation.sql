-- Replace the unreferenced LG food-assistance service with the existing
-- prepared-grocery workflow entry and place the canonical eight services in
-- their approved order. Service IDs remain globally keyed.

begin;

do $$
begin
  if not exists (
    select 1
    from public.service_configs
    where id = 'luis_donacion'
      and organization_id = 'luis-gabriel-referral-hub'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lg_grocery_expected_legacy_service';
  end if;

  if exists (
    select 1
    from public.service_configs
    where id = 'luis_compra_super'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lg_grocery_service_id_conflict';
  end if;

  if exists (
    select 1
    from public.leads
    where service_id = 'luis_donacion'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lg_grocery_legacy_service_has_leads';
  end if;

  if exists (
    select 1
    from public.referral_coupon_campaigns
    where service_id = 'luis_donacion'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lg_grocery_legacy_service_has_campaign';
  end if;
end
$$;

update public.service_configs
set id = 'luis_compra_super',
    nombre = 'Compras de supermercado',
    menu_label = 'Compras supermercado',
    tipo = 'static_action',
    activo = true,
    menu_orden = 1
where id = 'luis_donacion'
  and organization_id = 'luis-gabriel-referral-hub';

update public.service_configs as service
set menu_orden = canonical.menu_orden,
    activo = true
from (
  values
    ('luis_cupon_super', 2),
    ('luis_accidente', 3),
    ('luis_inmigracion', 4),
    ('luis_cupon_medico', 5),
    ('luis_cupon_dental', 6),
    ('luis_eventos', 7),
    ('luis_representante', 8)
) as canonical(id, menu_orden)
where service.id = canonical.id
  and service.organization_id = 'luis-gabriel-referral-hub';

alter table public.referral_orders
  drop constraint if exists referral_orders_source_channel_check;
alter table public.referral_orders
  add constraint referral_orders_source_channel_check
  check (source_channel in ('web', 'whatsapp', 'voice', 'qr', 'admin'));

do $$
declare
  v_expected_count integer;
begin
  select count(*)
  into v_expected_count
  from public.service_configs
  where organization_id = 'luis-gabriel-referral-hub'
    and activo is true
    and id in (
      'luis_compra_super',
      'luis_cupon_super',
      'luis_accidente',
      'luis_inmigracion',
      'luis_cupon_medico',
      'luis_cupon_dental',
      'luis_eventos',
      'luis_representante'
    );

  if v_expected_count <> 8 then
    raise exception using
      errcode = 'P0001',
      message = 'lg_grocery_expected_eight_active_services';
  end if;

  if exists (
    select 1
    from public.service_configs
    where id = 'luis_donacion'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lg_grocery_legacy_service_remains';
  end if;

  if exists (
    (
      values
        ('luis_compra_super', 'Compras de supermercado', 'Compras supermercado', 'static_action', 1),
        ('luis_cupon_super', 'Cupón de supermercado', 'Cupón supermercado', null, 2),
        ('luis_accidente', 'Accidente de auto', 'Accidente de auto', null, 3),
        ('luis_inmigracion', 'Inmigración', 'Inmigración', null, 4),
        ('luis_cupon_medico', 'Cupón médico', 'Cupón médico', null, 5),
        ('luis_cupon_dental', 'Cupón dental', 'Cupón dental', null, 6),
        ('luis_eventos', 'Eventos comunitarios', 'Eventos comunitarios', null, 7),
        ('luis_representante', 'Hablar con asesor', 'Hablar con asesor', null, 8)
      except
      select
        id,
        nombre,
        menu_label,
        case when id = 'luis_compra_super' then tipo else null end,
        menu_orden
      from public.service_configs
      where organization_id = 'luis-gabriel-referral-hub'
        and activo is true
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lg_grocery_catalog_verification_failed';
  end if;
end
$$;

commit;
