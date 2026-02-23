-- Guardrails for duplicates

-- Appointments: unique fingerprint based on org + normalized start + patient + reason
CREATE UNIQUE INDEX IF NOT EXISTS appointments_fingerprint_unique
ON public.appointments (
  organization_id,
  COALESCE(start_at, starts_at, (appointment_date::text || 'T' || COALESCE(appointment_time, '09:00') || ':00')::timestamptz),
  COALESCE(NULLIF(trim(patient_name), ''), ''),
  COALESCE(NULLIF(trim(reason), ''), '')
);

-- Messages: unique platform message id per org + channel when available
CREATE UNIQUE INDEX IF NOT EXISTS messages_platform_id_unique
ON public.messages (organization_id, channel, platform_message_id)
WHERE platform_message_id IS NOT NULL;
