-- Usage in psql/Supabase SQL editor:
-- set org id manually below.
-- Example: replace 'creatyv-product'

-- 0) Org context
with cfg as (
  select 'creatyv-product'::text as org_id,
         interval '60 seconds' as ttl
)
select * from cfg;

-- 1) Stuck processing older than TTL
with cfg as (
  select 'creatyv-product'::text as org_id,
         interval '60 seconds' as ttl
)
select
  r.id,
  r.lead_id,
  r.status,
  r.locked_at,
  r.locked_by,
  r.attempt_count,
  left(coalesce(r.last_error,''), 160) as last_error,
  r.scheduled_for,
  r.updated_at
from public.reply_outbox r, cfg
where r.organization_id = cfg.org_id
  and r.status = 'processing'
  and coalesce(r.locked_at, r.updated_at, r.created_at) <= now() - cfg.ttl
order by r.locked_at asc nulls first;

-- 2) Newest queued/pending jobs
select
  id,
  lead_id,
  status,
  scheduled_for,
  locked_at,
  locked_by,
  attempt_count,
  left(coalesce(last_error,''), 160) as last_error,
  created_at,
  updated_at
from public.reply_outbox
where organization_id = 'creatyv-product'
  and status in ('queued','pending')
order by scheduled_for asc nulls last, created_at desc
limit 50;

-- 3) Leads currently blocked by one_active_per_lead (active job exists)
-- (any lead with active job can block new active insert due to partial unique index)
select
  lead_id,
  count(*) as active_jobs,
  min(status) as sample_status,
  min(locked_at) as oldest_locked_at,
  max(updated_at) as last_update
from public.reply_outbox
where organization_id = 'creatyv-product'
  and status in ('queued','pending','processing')
group by lead_id
having count(*) >= 1
order by active_jobs desc, oldest_locked_at asc nulls first;

-- 4) last_error stats (top)
select
  regexp_replace(coalesce(last_error,''), '\\s+', ' ', 'g') as last_error,
  count(*) as n
from public.reply_outbox
where organization_id = 'creatyv-product'
  and coalesce(last_error,'') <> ''
group by 1
order by n desc
limit 20;

-- 5) Counts by status
select status, count(*)
from public.reply_outbox
where organization_id = 'creatyv-product'
group by status
order by count(*) desc;

-- 6) Throughput snapshot (last 30 min)
select
  count(*) filter (where status in ('queued','pending')) as queued_pending,
  count(*) filter (where status = 'processing') as processing,
  count(*) filter (where status = 'sent') as sent,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status = 'skipped') as skipped
from public.reply_outbox
where organization_id = 'creatyv-product'
  and created_at >= now() - interval '30 minutes';

-- 7) Safe manual reclaim helper (if worker is down)
-- Uncomment to reclaim stale processing > 60s back to pending:
-- update public.reply_outbox
-- set
--   status = 'pending',
--   locked_at = null,
--   locked_by = null,
--   claimed_at = null,
--   claimed_by = null,
--   last_error = 'manual_reclaim:processing_ttl_expired',
--   updated_at = now()
-- where organization_id = 'creatyv-product'
--   and status = 'processing'
--   and coalesce(locked_at, updated_at, created_at) <= now() - interval '60 seconds';
