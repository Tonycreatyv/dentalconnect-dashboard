# Shared migration bootstrap gap

Observed during an empty-database local Supabase bootstrap on 2026-08-02.

## Exact failure

The shared historical migration
`supabase/migrations/20260222_dedupe_guardrails.sql` runs:

```sql
create unique index if not exists appointments_fingerprint_unique
on public.appointments (...);
```

At that point in the historical chain, `public.appointments` does not exist, so
PostgreSQL stops with `relation "public.appointments" does not exist`.
Repository migrations that create the table appear later, including
`20260308_appointments_domain.sql` and `20260313_appointments.sql`.

## Why this is outside the Referral Hub rollout

The failing index belongs to the shared appointment domain used by existing
products. Neither approved Referral Hub pilot migration reads or alters
`public.appointments`, and the isolated production-shape harness applied the
current Referral Hub migrations successfully without that historical chain:

1. `20260801000100_referral_operations_pilot.sql`
2. `20260802000100_referral_grocery_delivery_coverage.sql`

The shared-chain failure therefore does not establish a defect in either pilot
migration. It does prevent the repository's complete historical migration set
from serving as an empty-database bootstrap.

## Why historical migrations were not changed

Those files may already be recorded as applied in deployed environments.
Editing, renaming, reordering, or conditionally weakening them could create
different schemas for existing DentalConnect, BarberLine, and new environments.
No historical migration was modified during Referral Hub validation.

## Recommended future repair

Handle this as a separate shared-database project with DentalConnect and
BarberLine regression coverage:

1. Produce and review a canonical shared schema baseline from the confirmed
   production structure, with sensitive data excluded.
2. Provide a supported fresh-install/bootstrap path that installs the baseline
   and records the superseded historical versions without replaying the broken
   ordering.
3. Validate the baseline in a disposable empty database, then replay every
   forward migration created after the baseline.
4. Compare constraints, indexes, functions, grants, and RLS against production
   before adopting the new bootstrap path.
5. Keep the already-applied historical files immutable.

Do not solve this by moving the appointment migration or dropping the duplicate
guardrail without a cross-product schema and behavior review.
