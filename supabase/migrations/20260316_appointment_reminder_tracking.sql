ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS reminder_status TEXT DEFAULT 'pending';
