-- Claim guardrail fields for run-replies

alter table public.reply_outbox
  add column if not exists scheduled_for timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists locked_at timestamptz;

update public.reply_outbox
set scheduled_for = coalesce(scheduled_for, created_at, now())
where scheduled_for is null;

create index if not exists reply_outbox_claim_ready_idx
on public.reply_outbox (organization_id, status, scheduled_for, claimed_at, locked_at);
