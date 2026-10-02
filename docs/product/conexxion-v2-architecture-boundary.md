# ConeXXion V2 architecture boundary

This file is intentionally small and executable as a review contract.

## Canonical operational model

ConeXXion V2 must treat a service request as the operational case:

- lead = person/context only
- referral_service_requests = case
- referral_assignments = responsibility/work lifecycle
- referral_operational_events = audit trail
- referral_operational_exceptions = actionable exceptions
- referral_partners = current partner directory

## Forbidden for new ConeXXion V2 operational writes

Do not add new V2 writes to:

- lead_assignments
- partners
- leads.status as the case lifecycle
- partner_recomendado as assignment state

These belong to legacy compatibility paths and must not become sources of truth again.

## Canonical mutation paths already present in production

- assign_referral_request(...)
- apply_partner_assignment_transition(...)
- partner_update_referral_assignment(...)
- resolve_referral_exception(...)

Admin mutations should wrap the same lifecycle engine with owner/admin authorization instead of duplicating transition logic.

## Deployment invariant

A change is not production-ready if the Git repository cannot reproduce the production Supabase schema/functions and Edge Function source used by ConeXXion.
