# ConeXXion V2 architecture boundary

ConeXXion V2 has one operational model. New code must not create a second source of truth.

## Canonical model

- `leads`: customer identity and conversation context only.
- `referral_service_requests`: operational case / request.
- `referral_assignments`: responsibility and work lifecycle.
- `referral_operational_events`: immutable audit trail.
- `referral_operational_exceptions`: actionable operational exceptions.
- `referral_partners`: current partner directory.

## Forbidden for new V2 operational writes

Do not introduce new ConeXXion V2 writes to:

- `lead_assignments`
- legacy `partners`
- `leads.status` as case lifecycle
- `partner_recomendado` as responsibility state

Legacy code may remain temporarily for compatibility, but it must not be reachable from the V2 Admin or Partner surfaces.

## Mutation boundary

Browser UI must not implement lifecycle transitions through ad-hoc table updates.

Canonical server-side entry points are:

- `assign_referral_request(...)`
- `apply_partner_assignment_transition(...)`
- `partner_update_referral_assignment(...)`
- `resolve_referral_exception(...)`
- Admin wrappers defined by the ConeXXion hardening migrations.

## Routing identity

Operational navigation uses `requestId` as the case identity. `leadId` is customer context and must not be used as a substitute for a case ID.

## Deployment invariant

A release is not production-ready unless:

1. Git can reproduce the Supabase schema and Edge Function source used by ConeXXion.
2. CI passes the ConeXXion architecture boundary, TypeScript typecheck, and production build.
3. No product-critical source exists only on a developer machine or only in the Supabase dashboard.
4. Database changes are migration-backed and reviewed before production application.
