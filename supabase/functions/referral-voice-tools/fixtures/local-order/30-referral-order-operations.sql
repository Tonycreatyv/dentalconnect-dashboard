begin;

-- Normalize legacy values before replacing the status constraints.
update public.referral_orders
set status = case status
  when 'completed' then 'delivered'
  when 'awaiting_partner_confirmation' then 'submitted'
  when 'draft' then 'submitted'
  else status
end,
submitted_at = case
  when status = 'draft' then coalesce(submitted_at, created_at, now())
  else submitted_at
end
where status in ('completed', 'awaiting_partner_confirmation', 'draft');

update public.referral_order_status_events
set from_status = case from_status
    when 'completed' then 'delivered'
    when 'awaiting_partner_confirmation' then 'submitted'
    when 'draft' then 'submitted'
    else from_status
  end,
  to_status = case to_status
    when 'completed' then 'delivered'
    when 'awaiting_partner_confirmation' then 'submitted'
    when 'draft' then 'submitted'
    else to_status
  end
where from_status in ('completed', 'awaiting_partner_confirmation', 'draft')
   or to_status in ('completed', 'awaiting_partner_confirmation', 'draft');

alter table public.referral_orders
  drop constraint if exists referral_orders_status_check;
alter table public.referral_orders
  add constraint referral_orders_status_check
  check (status in ('submitted', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'));
alter table public.referral_orders alter column status set default 'submitted';

alter table public.referral_order_status_events
  drop constraint if exists referral_order_status_events_from_status_check;
alter table public.referral_order_status_events
  drop constraint if exists referral_order_status_events_to_status_check;
alter table public.referral_order_status_events
  add constraint referral_order_status_events_from_status_check
  check (from_status is null or from_status in ('submitted', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'));
alter table public.referral_order_status_events
  add constraint referral_order_status_events_to_status_check
  check (to_status in ('submitted', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'));

create or replace function public.update_referral_order_status(
  p_organization_id text,
  p_order_id uuid,
  p_to_status text,
  p_note text default null
)
returns table (
  order_id uuid,
  status text,
  event_id uuid,
  event_created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order public.referral_orders%rowtype;
  v_event public.referral_order_status_events%rowtype;
  v_actor_id uuid := auth.uid();
  v_from_status text;
  v_transition_allowed boolean := false;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_organization_id is null or not public.user_belongs_to_org(p_organization_id) then
    raise exception using errcode = '42501', message = 'ORGANIZATION_ACCESS_DENIED';
  end if;
  if not exists (
    select 1
    from public.org_members as members
    where members.organization_id = p_organization_id
      and members.user_id = v_actor_id
      and members.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'ORDER_STATUS_ROLE_DENIED';
  end if;
  if p_to_status not in ('submitted', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'INVALID_ORDER_STATUS';
  end if;

  select * into v_order
  from public.referral_orders o
  where o.organization_id = p_organization_id
    and o.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;
  v_from_status := v_order.status;

  v_transition_allowed := case v_order.status
    when 'submitted' then p_to_status in ('confirmed', 'cancelled')
    when 'confirmed' then p_to_status in ('preparing', 'cancelled')
    when 'preparing' then p_to_status in ('ready', 'cancelled')
    when 'ready' then p_to_status in ('out_for_delivery', 'cancelled')
    when 'out_for_delivery' then p_to_status in ('delivered', 'cancelled')
    else false
  end;

  if not v_transition_allowed then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;

  update public.referral_orders
  set status = p_to_status
  where organization_id = p_organization_id and id = p_order_id
  returning * into v_order;

  insert into public.referral_order_status_events (
    organization_id,
    order_id,
    from_status,
    to_status,
    actor_type,
    actor_id,
    note,
    metadata
  ) values (
    p_organization_id,
    p_order_id,
    v_from_status,
    p_to_status,
    'staff',
    v_actor_id,
    nullif(trim(p_note), ''),
    jsonb_build_object('source', 'referral-orders-dashboard')
  ) returning * into v_event;

  return query select v_order.id, v_order.status, v_event.id, v_event.created_at;
end;
$function$;

revoke all on function public.update_referral_order_status(text, uuid, text, text) from public, anon;
grant execute on function public.update_referral_order_status(text, uuid, text, text) to authenticated;
grant execute on function public.update_referral_order_status(text, uuid, text, text) to service_role;

commit;
