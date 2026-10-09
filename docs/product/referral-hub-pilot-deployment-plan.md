# Referral Hub pilot — controlled rollout

No step in this document was executed while preparing the pilot.

## Production baseline

The production baseline is complete and reviewed. Do not regenerate or rerun
baseline SQL unless a genuinely new production dependency is discovered.

## A. Operational pilot migration

Apply `20260801000100_referral_operations_pilot.sql` first. It creates the
tenant-scoped request, partner-contact, assignment, notification, exception,
event, conversation-operation, note, and partner-token objects. Initial browser
access and mutation roles are exactly `owner` and `admin`.

It also creates the narrow service-role-only
`orchestrate_referral_service_request` boundary used by `run-replies` after
explicitly confirmed Referral Hub intake. Browser roles cannot execute it.

This migration does not create basket prices or delivery fees.
`public.referral_basket_offers` remains the canonical location-specific offer
source, and `public.referral_delivery_fee_bands` remains the canonical delivery
fee source.

## B. Deferred global membership hardening

Do **not** apply `20260801000200_referral_legacy_rls_hardening.sql` in this
pilot. Shared `Onboarding.tsx` still creates the initial owner membership from
the browser, so this global policy change could break DentalConnect and
BarberLine onboarding. Retain the file for a separate project that first moves
bootstrap membership creation behind a protected server-side function and then
regression-tests both products before hardening `org_members` globally.

## C. Grocery delivery coverage migration

After the operational migration, apply
`20260802000100_referral_grocery_delivery_coverage.sql`. It adds only the
tenant-scoped grocery delivery ZIP coverage table, its validation trigger,
index, RLS policies, and the reviewed LG six-location/13-row backfill.

The voice tool treats database coverage as authoritative once the table is
available. `SERVICE_ZIPS` remains only as a documented compatibility fallback
while this migration is not yet applied; an empty deployed coverage table does
not fall back to hard-coded rules.

This table represents grocery delivery ZIP eligibility only. Do not use it for
physical branch postal codes or non-grocery partner routing.

## D. Partner and contact seed data

Insert only reviewed LG partner contacts and service rules. Current production
partners are supermarkets only. Do not fabricate legal, immigration, dental,
medical, chiropractic, staff, destination, or routing data. Non-grocery
assignment must remain an explicit no-eligible-partner/configuration exception.

Generate portal tokens server-side and persist only SHA-256 hashes.

## E. Function deployment

1. `referral-manual-message`
2. `referral-partner-portal`
3. `run-replies` with the tenant-gated service-request bridge
4. `referral-voice-tools`

Partner notifications remain truthfully `queued` with channel
`pending_configuration` until an approved WhatsApp template/destination or a
real email provider exists.

The exact pilot migration order is:

1. `20260801000100_referral_operations_pilot.sql`
2. `20260802000100_referral_grocery_delivery_coverage.sql`

## F. Frontend deployment

Build and deploy only the standalone Referral Hub Netlify site after the SQL
migrations, seed review, and function smoke tests. Do not deploy
`creatyv-platform`.

The order UI must preserve the production state machine exactly:

`submitted → confirmed → preparing → ready → out_for_delivery → delivered`

Cancellation is available only from valid non-terminal states. `confirmed`
must not be renamed to `accepted`, and `ready` must not be removed.
