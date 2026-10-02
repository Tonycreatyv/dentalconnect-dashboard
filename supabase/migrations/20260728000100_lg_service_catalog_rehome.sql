-- Re-home the seven globally keyed LG services to their canonical tenant and
-- add the campaign-backed dental coupon service. Coupon commercial terms
-- remain exclusively in public.referral_coupon_campaigns.

begin;

do $$
declare
  v_expected_ids constant text[] := array[
    'luis_accidente',
    'luis_inmigracion',
    'luis_cupon_medico',
    'luis_cupon_super',
    'luis_eventos',
    'luis_donacion',
    'luis_representante'
  ];
  v_legacy_count integer;
  v_conflict_count integer;
begin
  select count(*)
    into v_legacy_count
    from public.service_configs
   where id = any(v_expected_ids)
     and organization_id = 'insurance-demo';

  if v_legacy_count <> 7 then
    raise exception using
      errcode = 'P0001',
      message = 'lg_service_rehome_expected_seven_legacy_rows';
  end if;

  select count(*)
    into v_conflict_count
    from public.service_configs
   where id = any(v_expected_ids)
     and organization_id is distinct from 'insurance-demo';

  if v_conflict_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'lg_service_rehome_tenant_conflict';
  end if;

  if exists (
    select 1
      from public.service_configs
     where id = 'luis_cupon_dental'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lg_service_rehome_dental_already_exists';
  end if;
end
$$;

update public.service_configs as service
   set organization_id = 'luis-gabriel-referral-hub',
       nombre = canonical.nombre,
       menu_label = canonical.menu_label,
       menu_orden = canonical.menu_orden,
       activo = true
  from (
    values
      ('luis_accidente', 'Accidente de auto', 'Accidente de auto', 1),
      ('luis_inmigracion', 'Inmigración', 'Inmigración', 2),
      ('luis_cupon_medico', 'Cupón médico', 'Cupón médico', 3),
      ('luis_cupon_super', 'Cupón de supermercado', 'Cupón supermercado', 4),
      ('luis_eventos', 'Eventos comunitarios', 'Eventos comunitarios', 6),
      ('luis_donacion', 'Asistencia alimentaria', 'Asistencia alimentaria', 7),
      ('luis_representante', 'Hablar con asesor', 'Hablar con asesor', 8)
  ) as canonical(id, nombre, menu_label, menu_orden)
 where service.id = canonical.id
   and service.organization_id = 'insurance-demo';

insert into public.service_configs (
  id,
  organization_id,
  nombre,
  menu_label,
  menu_orden,
  activo,
  tipo,
  intake_objectives,
  accion_estatica,
  criterios_calificacion,
  oferta,
  plantilla_resumen,
  icono,
  partner_id
)
values (
  'luis_cupon_dental',
  'luis-gabriel-referral-hub',
  'Cupón dental',
  'Cupón dental',
  5,
  true,
  'static_action',
  '[]'::jsonb,
  null,
  null,
  null,
  null,
  '🦷',
  null
);

do $$
declare
  v_expected_ids constant text[] := array[
    'luis_accidente',
    'luis_inmigracion',
    'luis_cupon_medico',
    'luis_cupon_super',
    'luis_cupon_dental',
    'luis_eventos',
    'luis_donacion',
    'luis_representante'
  ];
  v_canonical_count integer;
begin
  select count(*)
    into v_canonical_count
    from public.service_configs
   where id = any(v_expected_ids)
     and organization_id = 'luis-gabriel-referral-hub'
     and activo is true;

  if v_canonical_count <> 8 then
    raise exception using
      errcode = 'P0001',
      message = 'lg_service_rehome_canonical_count_failed';
  end if;

  if exists (
    select 1
      from public.service_configs
     where id = any(v_expected_ids)
       and organization_id = 'insurance-demo'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lg_service_rehome_legacy_rows_remain';
  end if;

  if exists (
    (
      values
        ('luis_accidente', 'Accidente de auto', 'Accidente de auto', 1),
        ('luis_inmigracion', 'Inmigración', 'Inmigración', 2),
        ('luis_cupon_medico', 'Cupón médico', 'Cupón médico', 3),
        ('luis_cupon_super', 'Cupón de supermercado', 'Cupón supermercado', 4),
        ('luis_cupon_dental', 'Cupón dental', 'Cupón dental', 5),
        ('luis_eventos', 'Eventos comunitarios', 'Eventos comunitarios', 6),
        ('luis_donacion', 'Asistencia alimentaria', 'Asistencia alimentaria', 7),
        ('luis_representante', 'Hablar con asesor', 'Hablar con asesor', 8)
      except
      select id, nombre, menu_label, menu_orden
        from public.service_configs
       where organization_id = 'luis-gabriel-referral-hub'
         and activo is true
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lg_service_rehome_catalog_verification_failed';
  end if;
end
$$;

commit;
