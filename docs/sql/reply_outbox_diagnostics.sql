-- Reply outbox diagnostics (paste into Supabase SQL Editor)
-- Set org + TTL seconds here
with cfg as (
  select
    'clinic-demo'::text as org_id,
    interval '60 seconds' as ttl
)
select 'stuck_processing' as check_name, count(*)::bigint as value
from public.reply_outbox r, cfg
where r.organization_id = cfg.org_id
  and r.status = 'processing'
  and coalesce(r.locked_at, r.claimed_at, r.processing_started_at, r.updated_at, r.created_at) < now() - cfg.ttl;

with cfg as (
  select 'clinic-demo'::text as org_id
)
select status, count(*)::bigint as total
from public.reply_outbox r, cfg
where r.organization_id = cfg.org_id
group by status
order by total desc;

with cfg as (
  select 'clinic-demo'::text as org_id
)
select
  lead_id,
  count(*) filter (where status in ('queued','pending','processing')) as active_jobs,
  min(created_at) as oldest_active,
  max(created_at) as newest_active
from public.reply_outbox r, cfg
where r.organization_id = cfg.org_id
group by lead_id
having count(*) filter (where status in ('queued','pending','processing')) > 1
order by active_jobs desc, oldest_active asc
limit 50;

with cfg as (
  select 'clinic-demo'::text as org_id
)
select
  coalesce(nullif(last_error, ''), 'none') as error,
  count(*)::bigint as total,
  max(updated_at) as last_seen,
  min(scheduled_for) as next_retry_min,
  max(scheduled_for) as next_retry_max
from public.reply_outbox r, cfg
where r.organization_id = cfg.org_id
  and status in ('pending','failed','processing')
group by coalesce(nullif(last_error, ''), 'none')
order by total desc, last_seen desc
limit 40;

with cfg as (
  select 'clinic-demo'::text as org_id
)
select
  id,
  lead_id,
  status,
  attempt_count,
  scheduled_for,
  locked_at,
  locked_by,
  left(coalesce(last_error, ''), 240) as last_error_snippet,
  created_at,
  updated_at
from public.reply_outbox r, cfg
where r.organization_id = cfg.org_id
  and status in ('queued','pending','processing','failed')
order by coalesce(scheduled_for, created_at, now()) asc
limit 200;
