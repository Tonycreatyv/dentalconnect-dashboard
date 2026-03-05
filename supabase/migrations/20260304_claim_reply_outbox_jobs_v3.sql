-- claim v3 compatibility wrapper (same semantics as v2)

create or replace function public.claim_reply_outbox_jobs_v3(
  p_org_id text,
  p_limit int,
  p_lock_owner text,
  p_lock_ttl_seconds int
)
returns setof public.reply_outbox
language sql
security definer
as $$
  select *
  from public.claim_reply_outbox_jobs_v2(
    p_org_id,
    p_limit,
    p_lock_owner,
    p_lock_ttl_seconds
  );
$$;

grant execute on function public.claim_reply_outbox_jobs_v3(text, int, text, int) to service_role;
grant execute on function public.claim_reply_outbox_jobs_v3(text, int, text, int) to authenticated;
