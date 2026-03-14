-- Strengthen anti-storm guards for run-replies

-- 1) Ensure reply_outbox cannot queue the same inbound provider message twice.
--    Helps keep multiple outbox jobs from racing to send the same reply when TTL reclaims.
CREATE UNIQUE INDEX IF NOT EXISTS reply_outbox_unique_inbound_provider
ON public.reply_outbox (organization_id, inbound_provider_message_id)
WHERE inbound_provider_message_id IS NOT NULL;

-- 2) Guarantee each inbound_message_id has at most one outbound assistant message.
--    This supports the duplicate-send guard in run-replies/index.ts and prevents double responses.
CREATE UNIQUE INDEX IF NOT EXISTS messages_unique_outbound_per_inbound
ON public.messages (organization_id, lead_id, inbound_message_id)
WHERE role = 'assistant' AND inbound_message_id IS NOT NULL;
