# Finish Postflow's private GitHub Pages setup

The Edge Function `postflow-api` is deployed to the Postflow Supabase project. It currently rejects every account until the owner account is created and its UUID is configured. This is intentional: the project is single-user, and the posts table has no public read/write policies.

## One-time owner setup

1. Open Supabase Dashboard > Authentication > Users for the Postflow project.
2. Add one user with your own email and a strong password. Do not enable public sign-ups.
3. Copy that user's UUID.
4. Open Edge Functions > Secrets and add:
   - `POSTFLOW_OWNER_USER_ID` = the UUID copied in step 3
   - `POSTFLOW_ALLOWED_ORIGIN` = `https://chimmysmallz.github.io`
5. Confirm the standard Supabase function environment variables are available: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

Do not put the service-role/secret key, Instagram token, TikTok token, or AI provider key in GitHub, `postflow-config.js`, or the browser. Add those only as Supabase Edge Function secrets when the integrations are approved.

## Current implementation status

- Supabase Auth session validation: implemented.
- Single-owner authorization: implemented, pending owner UUID secret.
- Post create/list/update/delete/retry: implemented.
- Media upload to the public `postflow-media` bucket: implemented (10 MB per file in this API).
- Template copy generation: implemented.
- AI copy generation: implemented when `TEXT_API_URL` and `TEXT_API_KEY` are configured as function secrets.
- TikTok creator info: implemented, pending TikTok token.
- Instagram/TikTok scheduled publishing worker and Cron: not yet migrated.
- Remotion rendering: not available on static hosting. Upload a rendered MP4 instead for now.
- GitHub Pages deployment: manual workflow only; run after owner setup and the API smoke test.

The public media bucket is required for social platforms to fetch media from HTTPS URLs. Anyone who has a media URL can view that file, so upload only content intended for public posting.
