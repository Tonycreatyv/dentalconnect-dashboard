# Referral Hub operational pilot — production rollout manifest

Prepared from branch `feature/referral-hub-standalone` at
`918d44d6bf09e12ddb45a5c4b8e22c004374d701`. This manifest authorizes no
deployment, SQL execution, secret change, or production-data mutation.

Canonical organization: `luis-gabriel-referral-hub`  
Supabase project: `oeeyzqqnxvcpibdwuugu`  
Standalone Netlify site: `e79d8471-f394-41dd-953b-49c3a57a50a0`

## Release decision

The Referral Hub pilot is isolated from the global membership hardening work.
`20260801000200_referral_legacy_rls_hardening.sql` is explicitly deferred and
must not be applied in this rollout. The new operational tables retain their
strict owner/admin read policies and service-role write boundary without
changing the existing shared `org_members_insert` onboarding behavior.

Production activation remains conditional on reviewed real partner/contact/
rule data and an approved notification provider. The code and two-migration
package may proceed to a controlled deployment only after the validation gates
in this manifest pass.

## Planned migration order

The intended order is fixed because later objects depend on earlier helpers:

1. `supabase/migrations/20260801000100_referral_operations_pilot.sql`
2. `supabase/migrations/20260802000100_referral_grocery_delivery_coverage.sql`

Current approval state:

| Migration | Classification | Decision |
| --- | --- | --- |
| `20260801000100_referral_operations_pilot.sql` | Required for operational pilot | Approved after final rollout gate |
| `20260801000200_referral_legacy_rls_hardening.sql` | Future global security project | **Deferred and excluded from pilot** |
| `20260802000100_referral_grocery_delivery_coverage.sql` | Required for grocery routing; depends on migration 1 | Approved after final rollout gate |

Future security project: replace browser bootstrap membership creation with a
protected server-side onboarding function, then harden `org_members` globally
and validate DentalConnect and BarberLine before applying the deferred file.

Historical migrations `20260727000100_referral_hub_coupons.sql`,
`20260728000100_lg_service_catalog_rehome.sql`,
`20260729000100_lg_grocery_service_activation.sql`,
`20260729000200_referral_coupon_delivery_events.sql`, and
`20260729000300_fix_leads_channel_identity_uniqueness.sql` are required
pre-existing product dependencies, but they are explicitly excluded from this
two-migration rollout and must not be reapplied as part of it.

## Approved Edge Function release inputs

### `referral-manual-message`

- `supabase/functions/referral-manual-message/index.ts`
- the `[functions.referral-manual-message]` entry in `supabase/config.toml`

It is hard-coded to LG, requires an authenticated owner/admin, validates the
lead/channel/recipient tuple, stores an idempotency key, and reports only
`queued` at enqueue time. It requires the operational-events table created by
migration 1.

### `referral-partner-portal`

- `supabase/functions/referral-partner-portal/index.ts`
- the `[functions.referral-partner-portal]` entry in `supabase/config.toml`

It requires assignment, request, event, and hashed access-token objects from
migration 1. Raw portal tokens are not stored by the migration or returned by
the dashboard.

### Required `run-replies` dirty dependency closure

Resolved with `deno info --json`; these are the only dirty files in the runtime
graph:

- `supabase/functions/run-replies/index.ts`
- `supabase/functions/run-replies/domain/stateNormalization.ts`
- `supabase/functions/run-replies/domain/referralHub/genericMenuRouter.ts`
- `supabase/functions/run-replies/domain/referralHub/serviceRequestOrchestrator.ts`
- `supabase/functions/run-replies/domain/referralHub/accidentHandoff.ts`
- `supabase/functions/run-replies/domain/referralHub/fieldInterpreter.ts`
- `supabase/functions/run-replies/domain/referralHub/couponService.ts`
- `supabase/functions/_products/referral-hub/config.ts`
- `supabase/functions/_shared/metaMessageAdapter.ts`

Unchanged runtime dependencies are bundled automatically, notably
`_products/referral-hub/index.ts`, `humanTakeover.ts`, `pantryDemoRouter.ts`,
`pantryDemoCatalog.ts`, and `pantryDeliveryCoverage.ts`.

Required behavior by slice:

- Messenger/WhatsApp intake, continuation, returning-user menus, terminal
  normalization, and Referral Hub routing: `index.ts`,
  `genericMenuRouter.ts`, and `stateNormalization.ts`.
- Accident/advisor handoff and truthful persistence outcome: `index.ts`,
  `genericMenuRouter.ts`, `accidentHandoff.ts`, and `fieldInterpreter.ts`.
- Confirmed accident/immigration/advisor and explicit event-follow-up
  orchestration: `index.ts`, `genericMenuRouter.ts`, and
  `serviceRequestOrchestrator.ts`. The service-role-only RPC in migration 1
  creates/reuses the prequalified request, deterministically assigns a reviewed
  rule/contact or creates an exception, queues a notification, and records
  events. Coupon, grocery, and informational event paths are excluded.
- Persistent coupons and error classification: `couponService.ts`,
  `genericMenuRouter.ts`, and product `config.ts`.
- Native Messenger image ordering and manual dashboard images: `index.ts` and
  `_shared/metaMessageAdapter.ts`.
- Other LG services, menu routing, city/date interpretation, and WhatsApp
  pantry compatibility: `genericMenuRouter.ts`, `fieldInterpreter.ts`, and the
  unchanged pantry modules.

`domain/outboxOutcome.ts` is not imported and is absent from the resolved
bundle. Its proposed global paused/skipped semantics are excluded.

### `referral-voice-tools`

All six local runtime files must deploy together:

- `supabase/functions/referral-voice-tools/index.ts`
- `supabase/functions/referral-voice-tools/handler.ts`
- `supabase/functions/referral-voice-tools/workflow.ts`
- `supabase/functions/referral-voice-tools/grocery.ts`
- `supabase/functions/referral-voice-tools/googleMaps.ts`
- `supabase/functions/referral-voice-tools/couponDelivery.ts`
- `supabase/functions/_products/referral-hub/config.ts`

Its resolved graph also imports these approved shared runtime dependencies:

- `supabase/functions/run-replies/domain/referralHub/couponService.ts`
- `supabase/functions/run-replies/domain/referralHub/fieldInterpreter.ts`
- unchanged `supabase/functions/run-replies/domain/referralHub/pantryDemoCatalog.ts`

Deploying only the `referral-voice-tools` directory while omitting the approved
shared files would produce a different bundle from the validated one.

## Edge Function deployment order

Only after both approved migrations and verification SQL pass:

1. `npx supabase functions deploy referral-manual-message --project-ref oeeyzqqnxvcpibdwuugu`
2. `npx supabase functions deploy referral-partner-portal --project-ref oeeyzqqnxvcpibdwuugu --no-verify-jwt`
3. `npx supabase functions deploy run-replies --project-ref oeeyzqqnxvcpibdwuugu --no-verify-jwt`
4. `npx supabase functions deploy referral-voice-tools --project-ref oeeyzqqnxvcpibdwuugu --no-verify-jwt`

Stop after any failed deployment or executed smoke test. Do not deploy
`meta-webhook`, Meta OAuth functions, DentalConnect, BarberLine, or any other
function in this rollout.

## Product-isolation findings

- The Referral Hub router is reached only for normalized business type
  `referral_hub`.
- New state normalization is gated to `referral_hub`; existing BarberLine
  normalization remains intact.
- Messenger image sending uses a new `imageUrl` branch. Existing text/quick
  reply behavior is unchanged when no image URL is supplied.
- `referral-manual-message` accepts only the LG organization.
- Voice persistence queries are fixed to LG; service listing supports only the
  explicit LG/demo allowlist.
- The frontend entry point imports only the standalone Referral Hub app.
- No changed Meta webhook or OAuth file is approved.
- The deferred RLS hardening migration is not part of any pilot command or
  verification expectation; shared onboarding remains unchanged.

## Standalone frontend build/deployment inputs

The following dirty frontend files are statically imported by the standalone
Referral Hub entry or copied into `dist` and are approved as one frontend slice:

- `src/apps/referral-hub/App.tsx`
- `src/apps/referral-hub/components/ReferralShell.tsx`
- `src/apps/referral-hub/components/OperationsUi.tsx`
- `src/apps/referral-hub/operations/navigation.ts`
- `src/apps/referral-hub/operations/useOperationalPilot.ts`
- `src/apps/referral-hub/operations/useReferralOperations.ts`
- `src/apps/referral-hub/pages/PilotPages.tsx`
- `src/apps/referral-hub/pages/ReferralMessages.tsx`
- `src/apps/referral-hub/pages/ReferralServices.tsx`
- `src/apps/referral-hub/pages/ReferralCampaigns.tsx`
- `src/apps/referral-hub/pages/ReferralSettings.tsx`
- `src/apps/referral-partner/pages/PartnerPortal.tsx`
- `src/pages/referral/ReferralHome.tsx`
- `src/pages/referral/ReferralKanban.tsx`
- `src/pages/referral/ReferralLeads.tsx`
- `src/pages/referral/ReferralMore.tsx`
- `src/pages/referral/ReferralOrders.tsx`
- `src/referral/orderTypes.ts`
- `src/referral/orders.ts`
- `src/referral/types.ts`
- `src/referral/useReferralData.ts`
- `src/index.css`
- `public/images/coupons/lg-dental-coupon.jpeg`
- `public/images/coupons/lg-medical-coupon.jpeg`
- `public/images/coupons/lg-supermarket-coupon.jpeg`
- `public/images/shop-essential.jpg`
- `public/images/shop-family.jpg`
- `public/images/shop-complete.jpg`

Build and deploy only this repository's `dist` to the standalone site:

```sh
npm run build
npx netlify deploy --prod --dir=dist --site=e79d8471-f394-41dd-953b-49c3a57a50a0
```

Do not deploy to `creatyv-platform` or a DentalConnect/BarberLine site.

## Files required for validation/package review but not runtime deployment

- `supabase/functions/referral-manual-message/index.test.ts`
- `supabase/functions/referral-manual-message/localSmoke.test.ts`
- `supabase/functions/referral-voice-tools/catalogMigration.test.ts`
- `supabase/functions/referral-voice-tools/couponDelivery.test.ts`
- `supabase/functions/referral-voice-tools/couponDeliveryMigration.test.ts`
- `supabase/functions/referral-voice-tools/googleMaps.test.ts`
- `supabase/functions/referral-voice-tools/grocery.test.ts`
- `supabase/functions/referral-voice-tools/groceryCoverageMigration.test.ts`
- `supabase/functions/referral-voice-tools/groceryMigration.test.ts`
- `supabase/functions/referral-voice-tools/index.test.ts`
- `supabase/functions/referral-voice-tools/leadsChannelIdentityMigration.test.ts`
- `supabase/functions/referral-voice-tools/localOrderIntegration.test.ts`
- `supabase/functions/referral-voice-tools/operationsPilotMigration.test.ts`
- `supabase/functions/referral-voice-tools/serviceRequestOrchestrationMigration.test.ts`
- `supabase/functions/referral-voice-tools/securityHardeningMigration.test.ts`
- `supabase/functions/referral-voice-tools/workflow.test.ts`
- `supabase/functions/run-replies/tests/couponService.test.ts`
- `supabase/functions/run-replies/tests/referralAccidentHandoff.test.ts`
- `supabase/functions/run-replies/tests/referralFieldInterpreter.test.ts`
- `supabase/functions/run-replies/tests/referralLgCommunity.test.ts`
- `supabase/functions/run-replies/tests/referralMessengerCoupons.test.ts`
- `supabase/functions/run-replies/tests/referralOperationalOrchestration.local.test.ts`
- `supabase/functions/run-replies/tests/serviceRequestOrchestrator.test.ts`
- `tests/referralHubOperations.test.ts`
- `tests/referralOrderStates.test.ts`
- `supabase/functions/referral-voice-tools/fixtures/local-order/README.md`
- `supabase/functions/referral-voice-tools/fixtures/local-order/00-local-prerequisites.sql`
- `supabase/functions/referral-voice-tools/fixtures/local-order/10-referral-order-foundation.sql`
- `supabase/functions/referral-voice-tools/fixtures/local-order/20-create-referral-order-rpc.sql`
- `supabase/functions/referral-voice-tools/fixtures/local-order/30-referral-order-operations.sql`
- `docs/product/referral-hub-operations-capabilities.md`
- `docs/product/referral-hub-pilot-deployment-plan.md`
- `docs/product/referral-hub-production-rollout-manifest.md`
- `docs/product/referral-hub-post-migration-verification.sql`
- `docs/product/referral-hub-reviewed-partner-seed-template.sql`

The production-baseline files under
`docs/product/production-baseline-sections/`, plus
`docs/product/referral-hub-production-baseline-required.sql`, are retained audit
evidence. The user has confirmed their production review is complete; they are
not deployment inputs and must not be rerun merely for this package.

## Unrelated existing work — explicitly excluded

- `supabase/functions/run-replies/domain/outboxOutcome.ts`
- `supabase/functions/run-replies/tests/outboxOutcome.test.ts`
- all files under `docs/product/elevenlabs-tools/`

## Uncertain files — exclude pending separate review

- `supabase/functions/_shared/conversationEngine.ts`: changed Referral Hub mode
  support used by `meta-webhook`, but it is not in either approved function
  graph and `meta-webhook` is outside this rollout.
- `supabase/functions/run-replies/tests/referralStateCompatibility.test.ts`:
  validates the preceding excluded Meta-webhook/shared-engine change and is not
  part of runtime deployment.
- `supabase/migrations/20260801000200_referral_legacy_rls_hardening.sql` is
  retained but explicitly deferred; it is not uncertain or deployable in this
  pilot.

No other dirty file remains unclassified.

## Post-migration verification

Execute `docs/product/referral-hub-post-migration-verification.sql` only after
all approved migrations have succeeded. It is read-only and produces one result
table covering:

- all 11 new tables;
- RLS enabled on every new table;
- all 13 expected new-table policies;
- the private orchestration RPC and its service-role-only grant;
- exactly 13 LG coverage rows and six locations;
- no non-LG coverage backfill rows;
- no cross-tenant relationship mismatch;
- no browser grants on hashed partner-token storage.

Every row must report `passed = true` before function deployment. The existing
`org_members_insert` policy is intentionally not tested or changed.

## Required reviewed partner information

No seed may be executed until all of the following are supplied and approved:

- real partner name, slug, UUID, status, and active decision;
- real contact name/title and at least one authorized phone, WhatsApp, or email;
- canonical service ID and optional existing partner-location UUID;
- notification channel and exact destination;
- contact notification priority;
- assignment priority/weight and acceptance SLA minutes;
- reviewed languages, specialties, cities, states, general service ZIPs, and
  operating hours;
- confirmation whether restrictions are intentionally empty/unrestricted.

Grocery delivery ZIPs belong only in
`referral_grocery_delivery_coverage`; they must not be copied into general
partner service rules without an independent business decision.

## Controlled smoke checklist

Record each check as passed, failed, or not executed. Stop on failure.

1. **Owner/admin access:** sign in as one real LG owner and one real LG admin;
   confirm operational tables load and permitted coverage mutations are tenant
   scoped.
2. **Nonmember denial:** authenticated nonmember cannot read pilot tables,
   change coverage, queue manual messages, or invoke assignment RPCs.
3. **Inbox queue truth:** send one controlled staff text; require HTTP 202,
   `delivery_status=queued`, one message, one outbox job, one operational event,
   and no duplicate on idempotent replay. Do not call it sent until a provider
   ID exists.
4. **Accident request assignment:** confirm the intake, then verify the worker's
   service-role orchestration creates one prequalified request, the matching
   reviewed assignment, acceptance deadline, queued notification attempt,
   hashed partner-token row, and events. Replay the same completion key and
   require the same IDs and one row of each kind.
5. **No eligible partner:** for a controlled request with no matching reviewed
   rule, require no assignment and one open `no_eligible_partner` exception.
6. **Partner portal token:** use the one-time raw token returned only across the
   service-role boundary; verify only its SHA-256 hash is stored, then verify
   view/accept/reject/work-state transitions, expiry, and revocation. Ordinary
   dashboard queries must never return token material.
7. **Grocery coverage:** check one covered and one uncovered ZIP; covered result
   must use only active database coverage rows and persisted location
   coordinates.
8. **Canonical basket/fee:** choose a real offer UUID at its matching location;
   verify order price and contents reload from `referral_basket_offers`, delivery
   fee reloads from `referral_delivery_fee_bands`, and caller-supplied price is
   impossible.
9. **Order states:** verify
   `submitted → confirmed → preparing → ready → out_for_delivery → delivered`;
   verify cancellation only from allowed nonterminal states.
10. **Coupon truth:** prepare each approved coupon; require database campaign,
    deterministic approved image, intro → native image → details ordering,
    persisted delivery tracking, and truthful failure without a delivery promise.

The runtime bridge is deterministic and tenant-gated. It runs only after an
explicit confirmed accident/immigration submission, an explicit advisor
request, or an explicit event follow-up request. It never selects partners in
the LLM/browser and never routes coupon or grocery completions into service
requests. Customer copy distinguishes queued, coordinator review, and failed
persistence; queued is never described as sent, delivered, accepted, or a
guaranteed callback.

Idempotency is enforced twice: the completed intake key uniquely identifies an
exact replay, while a partial unique index and transaction advisory lock on
organization + lead + service prevent two active requests even when separate
confirmation messages arrive concurrently. A new request is possible only
after the prior request leaves an active status.

## Package validation recorded on 2026-08-02

- Resolved dependency graphs: every dirty `run-replies` and
  `referral-voice-tools` runtime dependency appears in this manifest.
- Clean migration bootstrap: a draft of the operational migration and the
  coverage migration parsed and applied in order. The final active-request
  uniqueness tightening was added afterward and received static contract tests,
  but the current final migration could not be re-bootstrapped because the
  disposable Docker stack stalled/failed health checks. Post-migration SQL and
  the new database E2E were not executed.
- Referral voice tools: 90 passed, 0 failed, 1 environment-gated integration
  ignored by the default suite.
- Referral `run-replies`: 79 passed, 0 failed, 1 environment-gated local E2E
  ignored by the default suite.
- Operational migrations, manual-message source, and frontend assertions:
  24 passed, 0 failed.
- Deno checks: all six requested function/runtime entry points passed.
- Targeted standalone operational frontend typecheck: passed. The repository-
  wide typecheck remains blocked by 69 pre-existing shared-product errors.
- Frontend production build: passed; the existing large-chunk warning remains.
- `git diff --check`: passed.

Cross-product baseline suites are already red at the unchanged Git HEAD and
remain identically red in the working tree: BarberLine 350 passed/11 failed,
state-machine regression 0 passed/8 failed, and `engine.test.ts` has 35 type
errors before execution. Running `engine.test.ts` with type checking disabled
produced 4 passed/22 failed. These results do not show a new Referral Hub
regression, but they prevent a clean assertion that all DentalConnect and
BarberLine regressions pass.

The new orchestration E2E remains a rollout gate: it must pass against a healthy
disposable stack, including portal accept/contacted transitions, dashboard RLS
reads, idempotent replay, and cross-tenant denial. Do not infer a pass from the
successful migration application alone.
