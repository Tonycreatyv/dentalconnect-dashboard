# Creatyv WhatsApp Bridge — Phase 1

This directory is a Luis-only, local browser transport proof. It contains no
Referral Hub engine, coupon logic, order logic, ZIP routing, referral logic,
Claude prompts, cloud credentials, Supabase access, or Meta credentials.

## Run locally

Requirements:

- macOS on Intel or Apple Silicon
- Node.js 20 or newer
- Playwright Chromium installed with `npx playwright install chromium`
- A WhatsApp Business account that can link WhatsApp Web by QR code

From this directory:

```sh
npm install
npx playwright install chromium
npm test
npm run typecheck
npm start
```

The browser is always headed and uses the dedicated persistent profile at:

```text
data/whatsapp-profile/
```

Never point it at a normal Chrome profile. Only one bridge process may use this
profile at a time.

The CLI waits for manual QR login, asks the operator to open one controlled
direct-message chat, establishes a baseline, and waits for one new inbound text.
It prints only a hashed chat/message diagnostic. It sends the fixed Phase-1 test
reply only after the operator types `SEND` locally. It processes no second
message and never retries an `UNKNOWN` send.

## Stable identity and fail-closed behavior

The proof accepts only a stable direct-chat JID/phone identity exposed through
browser-visible `data-*`, message `data-id`, or phone-link evidence. Display
name, row position, unread count, avatar, text, and coordinates are never
identity. Conflicting or missing evidence prints:

```text
STABLE CHAT IDENTITY NOT PROVEN
```

The identity is re-read after the reply is populated and immediately before
Enter is pressed. Manual typing, navigation, or a mismatch pauses the send.

## Replaceable application vs persistent local data

Replaceable:

- `src/`
- `package.json`
- `package-lock.json`
- installed application/runtime files

Persistent and excluded from Git:

- `data/whatsapp-profile/`
- future narrow worker identity/configuration

Local diagnostics are also excluded:

- `diagnostics/`
- `*.log`

Application updates must never overwrite `data/`. Jose's profile, cookies,
browser storage, diagnostics, logs, `.env` files, Git metadata, or developer
credentials must never be packaged for Luis.

## Future thin-client API

Phase 1 makes no API calls. The future packaged bridge will communicate directly
from Luis's Mac to Creatyv cloud over TLS using four narrow capabilities:

- submit Luis inbound events
- claim Luis outbound commands
- acknowledge command results
- report worker/browser heartbeat

The credential will be bound server-side to:

```text
worker_id: luis-main-whatsapp
organization_id: luis-gabriel-referral-hub
```

The client will not be allowed to supply or override the organization. It will
have no raw database, customer-export, admin, partner-listing, or server-secret
access. If Creatyv revokes the credential, WhatsApp Web can still open locally,
but the bridge cannot receive business logic or automated reply commands.

## Future packaging

The source proof should later become a signed/notarized `Creatyv WhatsApp
Bridge.app`, or an interim `start.command`/`stop.command` bundle. Packaging must
include the compatible Playwright browser/runtime without including the Referral
Hub repository. Expected macOS concerns are Gatekeeper, quarantine attributes,
code signing/notarization, executable permissions, firewall prompts, browser
downloads, and preventing sleep. Launch-at-login and `launchd` are intentionally
outside Phase 1.
