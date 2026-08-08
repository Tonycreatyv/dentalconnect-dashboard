begin;

create or replace function public.create_referral_order(
  p_organization_id text,
  p_idempotency_key text,
  p_campaign_code text,
  p_source_channel text,
  p_partner_location_id uuid,
  p_basket_offer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_delivery_address text,
  p_delivery_city text,
  p_delivery_state text,
  p_delivery_postal_code text,
  p_delivery_country_code text,
  p_delivery_latitude numeric,
  p_delivery_longitude numeric,
  p_delivery_distance_miles numeric,
  p_delivery_duration_minutes integer,
  p_route_source text,
  p_customer_notes text,
  p_consent_transactional boolean,
  p_consent_marketing boolean,
  p_consent_version text
)
returns table (
  id uuid,
  order_code text,
  status text,
  partner_name text,
  partner_location_name text,
  basket_name text,
  basket_price_cents integer,
  delivery_fee_cents integer,
  total_cents integer,
  currency text,
  delivery_address text,
  coverage_status text,
  created_at timestamptz,
  idempotent_replay boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_existing public.referral_orders%rowtype;
  v_location public.referral_partner_locations%rowtype;
  v_partner public.referral_partners%rowtype;
  v_offer public.referral_basket_offers%rowtype;
  v_band public.referral_delivery_fee_bands%rowtype;
  v_order public.referral_orders%rowtype;
  v_attempt integer;
begin
  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception using errcode = 'P0001', message = 'CONFIGURATION_ERROR';
  end if;

  if p_idempotency_key is null or p_idempotency_key <> trim(p_idempotency_key)
     or length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id || ':' || p_idempotency_key, 0));

  select * into v_existing
  from public.referral_orders o
  where o.organization_id = p_organization_id
    and o.idempotency_key = p_idempotency_key;

  if found then
    return query select v_existing.id, v_existing.order_code, v_existing.status,
      v_existing.partner_name_snapshot, v_existing.partner_location_name_snapshot,
      v_existing.basket_name_snapshot, v_existing.basket_price_cents,
      v_existing.delivery_fee_cents, v_existing.total_cents, v_existing.currency,
      v_existing.delivery_address, v_existing.coverage_status, v_existing.created_at, true;
    return;
  end if;

  select * into v_location
  from public.referral_partner_locations l
  where l.organization_id = p_organization_id
    and l.id = p_partner_location_id
    and l.active;
  if not found or not v_location.delivery_enabled then
    raise exception using errcode = 'P0001', message = 'INVALID_PARTNER_LOCATION';
  end if;

  select * into v_partner
  from public.referral_partners p
  where p.organization_id = p_organization_id
    and p.id = v_location.partner_id
    and p.active
    and p.partnership_status in ('demo_reference', 'active');
  if not found then
    raise exception using errcode = 'P0001', message = 'INVALID_PARTNER_LOCATION';
  end if;

  select * into v_offer
  from public.referral_basket_offers b
  where b.organization_id = p_organization_id
    and b.partner_location_id = v_location.id
    and b.id = p_basket_offer_id
    and b.active;
  if not found then
    raise exception using errcode = 'P0001', message = 'INVALID_BASKET_OFFER';
  end if;

  if v_offer.price_cents < v_location.minimum_order_cents then
    raise exception using errcode = 'P0001', message = 'MINIMUM_ORDER_NOT_MET';
  end if;

  select * into v_band
  from public.referral_delivery_fee_bands b
  where b.organization_id = p_organization_id
    and b.partner_location_id = v_location.id
    and b.active
    and ((b.min_distance_miles = 0 and p_delivery_distance_miles >= 0)
      or (b.min_distance_miles > 0 and p_delivery_distance_miles > b.min_distance_miles))
    and p_delivery_distance_miles <= b.max_distance_miles
  order by b.min_distance_miles desc
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_UNAVAILABLE';
  end if;

  for v_attempt in 1..5 loop
    begin
      insert into public.referral_orders (
        organization_id, idempotency_key, status, campaign_code, source_channel,
        customer_name, customer_phone, customer_email, partner_id, partner_location_id,
        partner_name_snapshot, partner_location_name_snapshot, partner_address_snapshot,
        basket_offer_id, basket_key, basket_name_snapshot, basket_price_cents,
        basket_contents_snapshot, delivery_address, delivery_city, delivery_state,
        delivery_postal_code, delivery_country_code, delivery_latitude, delivery_longitude,
        delivery_distance_miles, delivery_duration_minutes, delivery_fee_band_id,
        delivery_fee_cents, route_source, coverage_status, subtotal_cents, total_cents,
        currency, customer_notes, consent_transactional, consent_marketing,
        consent_version, submitted_at
      ) values (
        p_organization_id, p_idempotency_key, 'submitted', nullif(trim(p_campaign_code), ''),
        p_source_channel, trim(p_customer_name), p_customer_phone, nullif(trim(p_customer_email), ''),
        v_partner.id, v_location.id, v_partner.name, v_location.name,
        v_location.formatted_address, v_offer.id, v_offer.basket_key, v_offer.display_name,
        v_offer.price_cents, v_offer.contents_snapshot, trim(p_delivery_address),
        trim(p_delivery_city), upper(trim(p_delivery_state)), trim(p_delivery_postal_code),
        upper(trim(p_delivery_country_code)), p_delivery_latitude, p_delivery_longitude,
        p_delivery_distance_miles, p_delivery_duration_minutes, v_band.id, v_band.fee_cents,
        p_route_source, 'available', v_offer.price_cents,
        v_offer.price_cents + v_band.fee_cents, v_offer.currency, nullif(trim(p_customer_notes), ''),
        p_consent_transactional, p_consent_marketing, nullif(trim(p_consent_version), ''), now()
      ) returning * into v_order;
      exit;
    exception when unique_violation then
      select * into v_existing from public.referral_orders o
      where o.organization_id = p_organization_id and o.idempotency_key = p_idempotency_key;
      if found then
        return query select v_existing.id, v_existing.order_code, v_existing.status,
          v_existing.partner_name_snapshot, v_existing.partner_location_name_snapshot,
          v_existing.basket_name_snapshot, v_existing.basket_price_cents,
          v_existing.delivery_fee_cents, v_existing.total_cents, v_existing.currency,
          v_existing.delivery_address, v_existing.coverage_status, v_existing.created_at, true;
        return;
      end if;
      if v_attempt = 5 then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
      end if;
    end;
  end loop;

  insert into public.referral_order_items (
    organization_id, order_id, item_type, item_reference_id, name_snapshot,
    quantity, unit_price_cents, total_price_cents, metadata
  ) values (
    p_organization_id, v_order.id, 'basket', v_offer.id, v_offer.display_name,
    1, v_offer.price_cents, v_offer.price_cents,
    jsonb_build_object('basket_key', v_offer.basket_key, 'catalog_version', v_offer.contents_snapshot->>'catalogVersion')
  );

  insert into public.referral_order_status_events (
    organization_id, order_id, from_status, to_status, actor_type, metadata
  ) values (p_organization_id, v_order.id, null, 'submitted', 'customer', '{"source":"create-referral-order"}'::jsonb);

  return query select v_order.id, v_order.order_code, v_order.status,
    v_order.partner_name_snapshot, v_order.partner_location_name_snapshot,
    v_order.basket_name_snapshot, v_order.basket_price_cents,
    v_order.delivery_fee_cents, v_order.total_cents, v_order.currency,
    v_order.delivery_address, v_order.coverage_status, v_order.created_at, false;
end;
$function$;

revoke all on function public.create_referral_order(
  text, text, text, text, uuid, uuid, text, text, text, text, text, text,
  text, text, numeric, numeric, numeric, integer, text, text, boolean, boolean, text
) from public, anon, authenticated;
grant execute on function public.create_referral_order(
  text, text, text, text, uuid, uuid, text, text, text, text, text, text,
  text, text, numeric, numeric, numeric, integer, text, text, boolean, boolean, text
) to service_role;

commit;
