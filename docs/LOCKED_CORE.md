# Locked Core Messaging (DentalConnect)

## Dataflow

1. Inbound producer (`meta-webhook`):
- Receives Messenger webhook event.
- Upserts `leads` (`organization_id`, `channel='messenger'`, `channel_user_id`).
- Inserts inbound row in `messages` (`role='user'`, `actor='user'`, `provider_message_id=mid`).
- Enqueues idempotent outbox job in `reply_outbox` with:
  - `status='queued'`
  - `inbound_provider_message_id=mid`
  - `payload.provider='meta'`, `payload.source='inbound'`
- Uses conflict key `(organization_id, inbound_provider_message_id)` to prevent storms.

2. Outbound consumer (`run-replies`):
- Claims jobs atomically via `claim_reply_outbox_jobs_v2(p_org_id, p_limit, p_lock_owner, p_lock_ttl_seconds)`.
- Processes each job once.
- Routes send by provider (`meta` now, `whatsapp/instagram` stubs).
- Finalizes each job to one terminal status: `sent | failed | skipped` and releases lock fields.

3. UI producer (`Inbox` manual send):
- Inserts immediate UI message in `messages` (`actor='human'`, `role='operator'`).
- Enqueues outbox job with `status='queued'`, `channel_user_id`, `payload.source='ui_manual'`, `payload.provider='meta'`.

4. Followups consumer (`run-followups`):
- Claims due jobs atomically via `claim_followup_outbox_jobs_v2(p_org_id, p_limit, p_lock_owner, p_lock_ttl_seconds)`.
- Sends followup only when `due_at <= now`.
- Cancels followup when lead already replied after followup was queued.
- Enforces step caps (`step <= max_steps`) to avoid spam.

## Prompt Modes

- `clinic-demo` => `dental_clinic`
- Other orgs default => `creatyv_product`
- If lead has no mode and inbound includes `#testdental`, mode initializes to `dental_clinic`.
- Mode is persisted in `leads.state.mode`.

## Provider Router

Current:
- `meta`/`messenger`: implemented through Graph `/me/messages`.

Future:
- Add `sendWhatsApp(...)` and `sendInstagram(...)` in `run-replies`.
- Keep same outbox contract (`reply_outbox` remains shared core queue).
- Only provider adapter changes; producer/consumer lifecycle remains unchanged.

## Smoke Tests

### Invoke worker
```bash
curl -i -X POST "https://<project>.supabase.co/functions/v1/run-replies" \
  -H "content-type: application/json" \
  -H "x-run-replies-secret: $RUN_REPLIES_SECRET" \
  -d '{"organization_id":"creatyv-product","limit":10,"lock_ttl_seconds":300}'
```

### Invoke followups worker
```bash
curl -i -X POST \"https://<project>.supabase.co/functions/v1/run-followups\" \\\n+  -H \"content-type: application/json\" \\\n+  -H \"x-run-followups-secret: $RUN_FOLLOWUPS_SECRET\" \\\n+  -d '{\"organization_id\":\"creatyv-product\",\"limit\":10,\"lock_ttl_seconds\":300}'
```

### Insert manual UI-style outbox job
```sql
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
  'creatyv-product',
  '<lead_uuid>',
  'messenger',
  '<psid>',
  'queued',
  now(),
  'Hola desde panel',
  jsonb_build_object('text','Hola desde panel','provider','meta','source','ui_manual')
);
```

### Verify
- New inbound produces exactly one queued outbox job.
- Worker response reports claimed/sent > 0.
- `reply_outbox.status` transitions to `sent` or `failed` (no indefinite `processing`).
