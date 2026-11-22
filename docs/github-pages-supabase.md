# GitHub Pages + Supabase deployment

## Target architecture

- GitHub Pages serves only the static Postflow interface.
- Supabase Auth handles sign-in. The old in-memory Node session cookie is not suitable for a static site hosted on a different origin.
- Supabase Edge Functions own privileged API operations, including social-provider credentials.
- Supabase Postgres stores scheduled posts and publishing state.
- Supabase Storage stores public media URLs required by Instagram and TikTok.
- Supabase Cron invokes a protected worker Edge Function to claim and process due posts.

## Important security rules

- Only a Supabase publishable key may appear in browser configuration.
- Supabase secret keys, Instagram tokens, TikTok tokens, AI provider keys and worker secrets stay in Edge Function secrets.
- The posts table remains inaccessible to the anon role. Edge Functions authenticate the user and perform authorized operations server-side.
- CORS must allow the exact GitHub Pages origin, not every origin.
- The media bucket is public by design because social platforms need to fetch media over HTTPS. Do not upload private files.

## Deployment status

The GitHub Pages workflow is intentionally manual and defaults to a disabled confirmation input. Do not deploy the current frontend yet: its API calls still target the original Node server and its login flow uses server-side cookies. Deploying now would produce a page that cannot manage posts.

The next implementation work is to migrate the browser API contract to Supabase Auth + Edge Functions, then add the scheduler worker and cron. Only after those pieces pass tests should the Pages workflow be run with `confirm_deploy=true`.

## Free-tier considerations

This design avoids Render and other paid always-on hosting. It still depends on Supabase Free quotas and availability. Supabase may pause an inactive free project, and Edge Functions / Storage / database usage are subject to plan limits. GitHub Pages is static hosting only; it does not run the Node scheduler or Remotion renderer.
