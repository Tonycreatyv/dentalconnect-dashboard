-- Replace with your org id
-- \set org_id 'creatyv-product'

-- 1) Stuck processing older than TTL (expect 0 after worker run)
select count(*) as stuck_processing_over_5m
from public.reply_outbox
where organization_id = :'org_id'
  and status = 'processing'
  and coalesce(locked_at, claimed_at, processing_started_at, updated_at, created_at) < now() - interval '5 minutes';

-- 2) Status distribution
select status, count(*)
from public.reply_outbox
where organization_id = :'org_id'
group by status
order by count(*) desc;

-- 3) Recently queued vs sent (last 30 min)
select
  count(*) filter (where status in ('queued','pending')) as queued_or_pending,
  count(*) filter (where status = 'sent') as sent,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status = 'skipped') as skipped
from public.reply_outbox
where organization_id = :'org_id'
  and created_at >= now() - interval '30 minutes';

-- 4) Last 20 jobs with timing/attempts
select
  id,
  lead_id,
  status,
  attempt_count,
  scheduled_for,
  locked_at,
  sent_at,
  left(coalesce(last_error,''), 200) as last_error,
  created_at,
  updated_at
from public.reply_outbox
where organization_id = :'org_id'
order by created_at desc
limit 20;
