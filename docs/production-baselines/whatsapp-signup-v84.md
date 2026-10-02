# Production Baseline: whatsapp-signup v84

- **Supabase project ref:** oeeyzqqnxvcpibdwuugu
- **Function:** whatsapp-signup
- **Production version:** 84
- **Production status:** ACTIVE
- **Deployment date/time:** 2026-08-17T02:37:51Z
- **Deployed function sha256 (esbuild bundle, per Supabase):** 85f50fb5cee94ce612bf4eb0e4a1a2e99d78e64c15c68cdd6022dcc2802ecac9
- **Local source sha256 (`supabase/functions/whatsapp-signup/index.ts`):** 39013834c628bfb64d0fd72cfa30c911d7901a346bd3393b55eb948aa78e0ad0

## What v84 contains

v84 includes the Meta-Support-confirmed `/subscribed_apps` read/parsing fix:

- `GET /{WABA_ID}/subscribed_apps?fields=id,name` (invalid projection, silently
  returned `{"data":[]}`) corrected to `GET /{WABA_ID}/subscribed_apps`
- Response parsing corrected to read `data[].whatsapp_business_api_data.id`
  and `data[].whatsapp_business_api_data.name` (the actual shape Meta returns
  for this edge) instead of a non-existent top-level `data[].id`

## Why this baseline was reconstructed rather than taken from Git history

Git HEAD for this file was drastically behind what was actually running in
production (414 lines at HEAD vs. 3,211 lines in the deployed function).
Production v83 was downloaded directly from Supabase via
`supabase functions download`, the subscribed_apps fix was applied to that
downloaded copy in an isolated temp workspace, validated, and deployed as v84.
This commit captures that verified v84 source as the new source-of-truth
baseline in Git, since Git history alone could not be trusted to reflect
what Supabase was actually serving.
