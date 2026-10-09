# Referral Hub production baseline

Captured before the controlled Referral Hub Messenger backend deployment.

## Repository state

- Repository: `/Users/jose/Development/Creatyv/Apps/referral-hub-app`
- Branch: `feature/referral-hub-standalone`
- HEAD: `77ead65 feat: add Referral Hub Messenger backend slice`
- Working tree before this report was created: clean
- Local backend source: validated by build, Deno checks, and focused tests (76 passed, 0 failed)

## Database baseline

The production schema was manually verified in the Supabase SQL Editor:

- `public.org_settings.meta_page_name` exists
- Type: `text`
- Nullable: yes
- No migration was required or applied

## Production Edge Functions

| Function | Production version | Status | Local source status |
| --- | ---: | --- | --- |
| `meta-oauth-state` | 59 | ACTIVE | Validated |
| `meta-oauth` | 141 | ACTIVE | Validated |
| `meta-webhook` | 276 | ACTIVE | Validated |
| `run-replies` | 433 | ACTIVE | Validated |

## DentalConnect frontend baseline

The Netlify deploy serving `dental.creatyv.io` is unchanged:

- Site: `creatyv-platform`
- Deploy ID: `6a6644a3687a857e388dc130`

This controlled backend deployment must not alter that site.

## Rollback procedure

If a newly deployed Edge Function fails validation, stop the deployment sequence and restore only that function:

1. Prefer the Supabase dashboard function-version rollback to the version recorded above.
2. If dashboard rollback is unavailable, recover the exact prior deployment source artifact and redeploy only the affected function with:

   `npx supabase functions deploy <function-name> --project-ref oeeyzqqnxvcpibdwuugu --no-verify-jwt`

3. Confirm the restored function is ACTIVE and repeat the applicable non-destructive smoke checks.
4. Do not use `supabase db push`, change secrets, deploy the frontend, or modify Meta/DNS settings as part of rollback.

Because a CLI deployment creates a new version, checking out a Git commit alone does not restore production. The exact prior source artifact or the platform version rollback must be used.
