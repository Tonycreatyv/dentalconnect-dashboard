-- Create appointments table for booking metadata
create table if not exists public.appointments (
    id uuid primary key default gen_random_uuid(),
    organization_id text not null,
    patient_id uuid null,
    conversation_id uuid null,
    scheduled_date date null,
    scheduled_time text null,
    status text not null default 'pending',
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists appointments_organization_id_idx on public.appointments (organization_id);
create index if not exists appointments_patient_id_idx on public.appointments (patient_id);
create index if not exists appointments_scheduled_date_idx on public.appointments (scheduled_date);
