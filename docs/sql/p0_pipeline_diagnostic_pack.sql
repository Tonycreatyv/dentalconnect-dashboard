-- P0 pipeline diagnostics
-- set org + TTL
with cfg as (
  select 'clinic-demo'::text as org_id, interval '60 seconds' as ttl
)
select
  count(*)::bigint as stuck_processing_older_than_ttl
from public.reply_outbox r, cfg
where r.organization_id = cfg.org_id
  and r.status = 'processing'
  and coalesce(r.locked_at, r.claimed_at, r.processing_started_at, r.updated_at, r.created_at) < now() - cfg.ttl;

with cfg as (
  select 'clinic-demo'::text as org_id
)
select
  status,
  count(*)::bigint as total,
  avg(extract(epoch from (now() - coalesce(updated_at, created_at))))::int as avg_age_seconds
from public.reply_outbox r, cfg
where r.organization_id = cfg.org_id
group by status
order by total desc;

-- potential blockers by one_active_per_lead index
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
limit 100;

with cfg as (
  select 'clinic-demo'::text as org_id
)
select
  left(coalesce(last_error, 'none'), 180) as last_error,
  count(*)::bigint as total
from public.reply_outbox r, cfg
where r.organization_id = cfg.org_id
  and status in ('failed','dead','failed_terminal','pending')
group by left(coalesce(last_error, 'none'), 180)
order by total desc
limit 20;

with cfg as (
  select 'clinic-demo'::text as org_id
)
select
  date_trunc('hour', sent_at) as hour,
  count(*)::bigint as sent_count
from public.reply_outbox r, cfg
where r.organization_id = cfg.org_id
  and r.status = 'sent'
  and r.sent_at >= now() - interval '24 hours'
group by date_trunc('hour', sent_at)
order by hour asc;
