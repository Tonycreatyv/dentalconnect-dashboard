# Draft Meta Flow change — direct-entry screens for Supermercado / Médico / Ver otros

**Status: DRAFT. Not uploaded, not published. Requires explicit approval before any Flows API call is made.**

## Problem this solves

`flow_action_payload.screen` (the CTA's initial screen) must be an entry screen —
Meta's own docs: *"The ID of the screen displayed first... It needs to be an
entry screen"*, and the `INVALID_ROUTING_MODEL` error defines that as *"a
screen with no inbound edges."* In the currently published
`luis-unified-services-flow.json` (flow_id `2465563120620708`), only
`SERVICE_SELECT` has zero inbound edges — `BENEFIT_SELECT` (1 inbound edge,
from `SERVICE_SELECT`) and `BENEFIT_DETAILS` (1 inbound edge, from
`BENEFIT_SELECT`) do not qualify. So every CTA, regardless of which benefit
the customer already named in WhatsApp, can only ever open on `SERVICE_SELECT`
— the full general menu (Beneficios y cupones / Inmigración / Accidente /
DUI / Hablar con equipo) — forcing the customer to re-select a category they
already picked.

## The fix

Purely additive. Add 3 new screens with **zero inbound edges** (nothing in
the Flow navigates to them), so each independently qualifies as a valid
`flow_action_payload.screen` target:

| New screen | Reached from CTA when | Behavior |
|---|---|---|
| `SUPERMARKET_ENTRY` | customer already said/tapped Supermercado | 1 short intro line + "Ver mi beneficio" → navigates straight to `BENEFIT_DETAILS` with `benefit_key: "SUPERMARKET"` hardcoded |
| `MEDICAL_ENTRY` | customer already said/tapped Médico | same pattern, `benefit_key: "MEDICAL"` |
| `BENEFITS_ENTRY` | "Ver otros" / "Ver beneficios" (no specific benefit named) | identical content to the existing `BENEFIT_SELECT` screen (all 4 benefits) — skips `SERVICE_SELECT`'s unrelated immigration/accident/DUI/handoff options |

`SERVICE_SELECT`, `BENEFIT_SELECT`, `BENEFIT_DETAILS`, and every legal/
accident/criminal/handoff screen are copied byte-for-byte unchanged. "Ver
servicios" and "Menú principal" keep targeting `SERVICE_SELECT` exactly as
today (out of scope, per the task's own instructions) — this change only
adds new, independent entry points; it does not touch how anyone reaches the
existing screens today.

The literal (non-form) `benefit_key` value in `SUPERMARKET_ENTRY`/
`MEDICAL_ENTRY`'s navigate payload is the same JSON pattern already used
elsewhere in this exact Flow (`HANDOFF_CONFIRM`'s `complete` action sends a
literal `"service_key": "HANDOFF"`), not a new capability being introduced.

`benefit_key` reaches Flow completion exactly as it does today —
`BENEFIT_DETAILS`'s own Footer (unchanged) already reads whatever
`data.benefit_key` it was navigated with and submits it back on `complete`.
`parseLuisBenefitFlowCompletion` (unchanged, already generic across all 4
benefits) needs no changes.

## What is NOT changed

- No existing screen, field, or routing edge is removed or altered.
- `IMMIGRATION_TOPIC`/`ACCIDENT_BASICS`/`CRIMINAL_TOPIC`/`HANDOFF_CONFIRM` and
  their detail screens are untouched.
- The Flow's `flow_id` stays `2465563120620708` — this is a new JSON version
  uploaded to the *same* Flow, not a new Flow.

## Required steps (none performed by this change)

1. Review the full draft: `20260826_draft_luis_unified_services_flow_direct_entry_screens.json` in this directory.
2. Strip every `_draft_note`/`_new_screen_note` key (not valid Flow JSON, added here only for human review).
3. Upload the resulting JSON to flow_id `2465563120620708` via the Flows API or WhatsApp Manager.
4. Publish, then confirm `health_status.can_send_message` is `AVAILABLE` (not `BLOCKED`) before anything depends on it.
5. Only after the Flow is confirmed live: deploy the corresponding `run-replies` code change (already implemented locally, gated on this — see the accompanying report) that points the Supermercado/Médico/Ver-otros CTAs at these new screens.

Deploying the `run-replies` code change **before** this Flow is published
would send WhatsApp a `flow_action_payload.screen` naming a screen that does
not yet exist in the live Flow, which will fail for real customers. Sequencing
matters: Flow first, confirmed live, then `run-replies`.
