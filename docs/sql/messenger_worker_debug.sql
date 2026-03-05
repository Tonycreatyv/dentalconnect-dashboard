-- Debug recent outbox jobs for one lead
-- replace values before running
with params as (
  select
    'clinic-demo'::text as org_id,
    '00000000-0000-0000-0000-000000000000'::uuid as lead_id,
    interval '60 seconds' as ttl
)
select
  id,
  status,
  scheduled_for,
  locked_at,
  locked_by,
  attempt_count,
  left(coalesce(last_error, ''), 220) as last_error,
  created_at,
  updated_at,
  payload
from public.reply_outbox r, params p
where r.organization_id = p.org_id
  and r.lead_id = p.lead_id
order by created_at desc
limit 20;

-- Requeue stale processing jobs older than TTL
with params as (
  select
    'clinic-demo'::text as org_id,
    interval '60 seconds' as ttl
), requeued as (
  update public.reply_outbox r
  set
    status = 'queued',
    locked_at = null,
    locked_by = null,
    claimed_at = null,
    claimed_by = null,
    updated_at = now(),
    last_error = coalesce(nullif(last_error, ''), 'requeued_stale_processing')
  from params p
  where r.organization_id = p.org_id
    and r.status = 'processing'
    and coalesce(r.locked_at, r.claimed_at, r.processing_started_at, r.updated_at, r.created_at) < now() - p.ttl
  returning r.id
)
select count(*) as requeued_count from requeued;
