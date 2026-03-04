-- Smart Waitlist Fill Engine
-- cancellation -> slot hold -> offer top 3 (auto or CTA) -> dedupe 7d -> cap 3 -> expiration wave

alter table if exists public.slot_holds
  add column if not exists slot_hold_scope text not null default 'lead',
  add column if not exists slot_key text,
  add column if not exists offer_batch integer not null default 1;

alter table if exists public.slot_holds
  alter column lead_id drop not null;

alter table if exists public.slot_holds
  drop constraint if exists slot_holds_status_check;

alter table if exists public.slot_holds
  add constraint slot_holds_status_check
  check (status in ('held', 'accepted', 'expired', 'cancelled', 'fulfilled'));

create index if not exists slot_holds_scope_status_idx
  on public.slot_holds (organization_id, slot_hold_scope, status, hold_until);

create unique index if not exists slot_holds_slot_single_active
  on public.slot_holds (organization_id, slot_start, coalesce(slot_end, slot_start), coalesce(service_type, 'general'))
  where slot_hold_scope = 'slot' and status = 'held';

create or replace function public.ensure_slot_hold(
  p_org_id text,
  p_slot_start timestamptz,
  p_slot_end timestamptz,
  p_service_type text default 'general',
  p_source text default 'system'
)
returns text
language plpgsql
security definer
as $$
declare
  v_service text := coalesce(nullif(trim(p_service_type), ''), 'general');
  v_slot_key text;
begin
  v_slot_key := format(
    '%s|%s|%s',
    p_org_id,
    to_char(p_slot_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    coalesce(lower(v_service), 'general')
  );

  insert into public.slot_holds (
    organization_id,
    lead_id,
    slot_start,
    slot_end,
    service_type,
    hold_until,
    status,
    source,
    slot_hold_scope,
    slot_key,
    metadata,
    updated_at
  )
  values (
    p_org_id,
    null,
    p_slot_start,
    p_slot_end,
    v_service,
    now() + interval '30 minutes',
    'held',
    p_source,
    'slot',
    v_slot_key,
    jsonb_build_object('created_by', p_source),
    now()
  )
  on conflict (organization_id, slot_start, coalesce(slot_end, slot_start), coalesce(service_type, 'general'))
  where slot_hold_scope = 'slot' and status = 'held'
  do update set
    hold_until = excluded.hold_until,
    updated_at = now(),
    source = excluded.source;

  return v_slot_key;
end;
$$;

grant execute on function public.ensure_slot_hold(text, timestamptz, timestamptz, text, text)
  to service_role;

create or replace function public.offer_waitlist_for_slot(
  p_org_id text,
  p_slot_start timestamptz,
  p_slot_end timestamptz,
  p_service_type text default 'general',
  p_trigger_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_now timestamptz := now();
  v_service text := coalesce(nullif(trim(p_service_type), ''), 'general');
  v_text text;
  v_count integer := 0;
  v_row record;
  v_lead_ids uuid[] := '{}';
  v_hold_id uuid;
  v_slot_key text;
  v_batch int := 1;
begin
  if p_org_id is null or trim(p_org_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_org_id');
  end if;

  if p_slot_start is null then
    return jsonb_build_object('ok', false, 'error', 'missing_slot_start');
  end if;

  v_slot_key := public.ensure_slot_hold(
    p_org_id,
    p_slot_start,
    p_slot_end,
    v_service,
    p_trigger_source
  );

  select coalesce(max(offer_batch), 0) + 1
    into v_batch
  from public.slot_holds
  where organization_id = p_org_id
    and slot_key = v_slot_key
    and slot_hold_scope = 'lead';

  for v_row in
    with candidates as (
      select
        w.id as waitlist_id,
        w.lead_id,
        coalesce(nullif(l.channel, ''), 'messenger') as channel,
        l.channel_user_id,
        row_number() over (
          order by coalesce(w.priority, 0) desc, w.created_at asc
        ) as rn
      from public.waitlist w
      join public.leads l
        on l.id = w.lead_id
       and l.organization_id = p_org_id
      where w.organization_id = p_org_id
        and w.status = 'active'
        and w.lead_id is not null
        and l.channel_user_id is not null
        and l.channel_user_id <> ''
        and (
          v_service = 'general'
          or w.service_type is null
          or w.service_type = ''
          or lower(w.service_type) = lower(v_service)
        )
        and not exists (
          select 1
          from public.reply_outbox r
          where r.organization_id = p_org_id
            and r.lead_id = w.lead_id
            and r.created_at >= (v_now - interval '7 days')
            and coalesce(r.payload ->> 'source', '') = 'system_waitlist_offer'
        )
    )
    select *
    from candidates
    where rn <= 3
  loop
    insert into public.slot_holds (
      organization_id,
      lead_id,
      slot_start,
      slot_end,
      service_type,
      hold_until,
      status,
      source,
      slot_hold_scope,
      slot_key,
      offer_batch,
      metadata,
      updated_at
    )
    values (
      p_org_id,
      v_row.lead_id,
      p_slot_start,
      p_slot_end,
      v_service,
      v_now + interval '30 minutes',
      'held',
      p_trigger_source,
      'lead',
      v_slot_key,
      v_batch,
      jsonb_build_object('waitlist_id', v_row.waitlist_id),
      v_now
    )
    on conflict do nothing
    returning id into v_hold_id;

    if v_hold_id is null then
      continue;
    end if;

    v_text := format(
      'Se liberó un turno %s para %s. ¿Te interesa tomarlo?',
      to_char(p_slot_start, 'DD/MM HH24:MI'),
      v_service
    );

    insert into public.reply_outbox (
      organization_id,
      lead_id,
      channel,
      channel_user_id,
      status,
      scheduled_for,
      message_text,
      payload
    )
    values (
      p_org_id,
      v_row.lead_id,
      v_row.channel,
      v_row.channel_user_id,
      'queued',
      v_now,
      v_text,
      jsonb_build_object(
        'source', 'system_waitlist_offer',
        'provider', 'meta',
        'text', v_text,
        'slot_start', p_slot_start,
        'slot_end', p_slot_end,
        'service_type', v_service,
        'slot_key', v_slot_key,
        'slot_hold_id', v_hold_id,
        'trigger_source', p_trigger_source,
        'offer_batch', v_batch
      )
    );

    update public.waitlist
      set status = 'contacted'
    where id = v_row.waitlist_id;

    v_count := v_count + 1;
    v_lead_ids := array_append(v_lead_ids, v_row.lead_id);
    v_hold_id := null;
  end loop;

  if v_count > 0 then
    insert into public.alerts (
      organization_id,
      type,
      severity,
      title,
      body,
      action,
      status
    )
    values (
      p_org_id,
      'waitlist_offer_sent',
      'info',
      format('Slot offered to %s patients', v_count),
      case when p_trigger_source = 'auto'
        then format('Offered automatically to %s patients', v_count)
        else format('Ofertas enviadas a %s pacientes', v_count)
      end,
      jsonb_build_object(
        'source', p_trigger_source,
        'sent', v_count,
        'service_type', v_service,
        'slot_start', p_slot_start,
        'slot_end', p_slot_end,
        'slot_key', v_slot_key,
        'offer_batch', v_batch,
        'lead_ids', to_jsonb(v_lead_ids)
      ),
      'open'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'queued', v_count,
    'hold_ttl_minutes', 30,
    'service_type', v_service,
    'slot_start', p_slot_start,
    'slot_end', p_slot_end,
    'slot_key', v_slot_key,
    'offer_batch', v_batch,
    'lead_ids', to_jsonb(v_lead_ids)
  );
end;
$$;

grant execute on function public.offer_waitlist_for_slot(text, timestamptz, timestamptz, text, text)
  to service_role;

grant execute on function public.offer_waitlist_for_slot(text, timestamptz, timestamptz, text, text)
  to authenticated;

create or replace function public.create_waitlist_offer_alert_on_cancel()
returns trigger
language plpgsql
security definer
as $$
declare
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_service text;
  v_alert_id uuid;
  v_mode text := 'semi_auto';
  v_auto_result jsonb;
  v_slot_key text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if coalesce(old.status, '') is distinct from coalesce(new.status, '')
     and lower(coalesce(new.status, '')) = 'cancelled' then
    v_slot_start := coalesce(new.start_at, new.starts_at);
    v_slot_end := coalesce(new.start_at, new.starts_at) + interval '1 hour';
    v_service := nullif(coalesce(new.reason, new.title, ''), '');

    insert into public.appointment_events(
      organization_id,
      appointment_id,
      event_type,
      payload
    ) values (
      new.organization_id,
      new.id,
      'cancelled',
      jsonb_build_object(
        'slot_start', v_slot_start,
        'slot_end', v_slot_end,
        'service_type', coalesce(v_service, 'general')
      )
    );

    v_slot_key := public.ensure_slot_hold(
      new.organization_id,
      v_slot_start,
      v_slot_end,
      coalesce(v_service, 'general'),
      'cancelled_event'
    );

    insert into public.alerts(
      organization_id,
      type,
      severity,
      title,
      body,
      action,
      status
    ) values (
      new.organization_id,
      'waitlist_offer_ready',
      'warning',
      'Slot available',
      format('Slot freed at %s', to_char(v_slot_start, 'DD/MM HH24:MI')),
      jsonb_build_object(
        'slot_start', v_slot_start,
        'slot_end', v_slot_end,
        'service_type', coalesce(v_service, 'general'),
        'appointment_id', new.id,
        'cap', 3,
        'hold_ttl_minutes', 30,
        'slot_key', v_slot_key
      ),
      'open'
    ) returning id into v_alert_id;

    update public.actions
      set status = 'completed'
    where organization_id = new.organization_id
      and type = 'appointment_cancelled'
      and status = 'open';

    insert into public.actions(
      organization_id,
      type,
      title,
      description,
      priority,
      status,
      payload
    ) values (
      new.organization_id,
      'appointment_cancelled',
      'Slot freed tomorrow 3pm',
      'A cancellation opened a slot. Offer to waitlist.',
      100,
      'open',
      jsonb_build_object(
        'slot_start', v_slot_start,
        'slot_end', v_slot_end,
        'service_type', coalesce(v_service, 'general'),
        'slot_key', v_slot_key
      )
    );

    select coalesce(waitlist_offer_mode, 'semi_auto')
      into v_mode
    from public.org_settings
    where organization_id = new.organization_id
    limit 1;

    if v_mode = 'auto' then
      v_auto_result := public.offer_waitlist_for_slot(
        new.organization_id,
        v_slot_start,
        v_slot_end,
        coalesce(v_service, 'general'),
        'auto'
      );

      update public.alerts
      set
        status = 'resolved',
        resolved_at = now(),
        action = coalesce(action, '{}'::jsonb) || jsonb_build_object('auto_result', v_auto_result)
      where id = v_alert_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_waitlist_offer_alert on public.appointments;
create trigger appointments_waitlist_offer_alert
after update on public.appointments
for each row
execute function public.create_waitlist_offer_alert_on_cancel();
