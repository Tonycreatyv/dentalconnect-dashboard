# Referral Hub operations capability matrix

| Module | Current data source | Existing mutations | Missing capability | Implementation | Next backend work |
| --- | --- | --- | --- | --- | --- |
| Home | `leads`, `messages`, `service_configs` | None | Explicit unread/follow-up/handoff fields | Real counts and truthful zero states | Add durable unread, follow-up due, handoff and delivery-state fields |
| Inbox | `messages`, `leads`, `service_configs` | Manual message insert; lead status update | Read/unread, staff assignment, notes, automation toggle | Three-panel desktop Inbox; unsupported actions labeled | Add conversation state/assignment/notes API with RLS |
| Leads | `leads`, `service_configs`, `partners` | Create lead; update status; partner assignment | General safe-profile edit API and pagination RPC | Search/filter/sort/table; safe 200-row cap | Add paginated lead query and audited profile update RPC |
| Pipeline | `leads.status` | Status update | None for selector workflow | Five operational columns with reliable selectors | Optional audited drag/drop later |
| Services | Code router plus `service_configs` | None in standalone app | Editable service configuration | Read-only system catalog | Add tenant service configuration table/RPC and validation |
| Campaigns | Lead extracted source fields only | None | Campaign entity and attribution | Truthful empty state | Add campaigns table, attribution foreign key and QR/link RPC |
| Coupons | Existing coupon RPCs | Lookup/redeem when feature enabled | Campaign authoring | Existing tools remain feature-gated | Add campaign/coupon administration APIs if required |
| Orders | `referral_orders`, status events | Existing status RPC | None for current workflow | Existing functionality retained behind flags | No change required |
| Integrations | `org_settings` | Existing Messenger OAuth/disconnect | Last inbound summary and safer disconnect RPC | Desktop grid; Page name/ID/status; tokens hidden | Add integration activity view/RPC and audited disconnect endpoint |
| Settings | Auth session, canonical org context | Sign out | Staff roles/preferences | Read-only identity and canonical tenant security | Add tenant-scoped staff/role settings if needed |

## Status vocabulary

The current production lead values remain authoritative: `new`, `contacted`, `qualified`, `sent_to_partner`, `closed`, and `not_qualified`. The UI presents them as Nuevo, Contactado, Seguimiento/Calificado, Referido, Completado/Cerrado, and No interesado/No califica without changing schema.

## Deferred actions

Unread state, staff assignment, notes, automation pause/resume, editable services, campaign creation, and campaign QR generation are not simulated or stored in `localStorage`. They require tenant-scoped persistence and audited RLS/RPC support.
