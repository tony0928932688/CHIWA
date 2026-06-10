# CHIWA AI Website Transfer Manifest

This folder is the complete source package for moving the site to GitHub, another computer, or another hosting provider.

## Publish These Files

- `index.html`
- `privacy.html`
- `terms.html`
- `CNAME`
- `assets/`
- `.github/`
- `supabase/`
- `cloudflare/`
- `supabase_chiwa_course_schema.sql`
- `supabase_security_hardening_20260525.sql`
- `.gitignore`

## Do Not Publish

- `.git/`
- `.wrangler/`
- `.wrangler-config/`
- `node_modules/`
- `dist/`
- `*.zip`
- `index.backup-before-dedupe-*.html`
- any old local test or backup HTML file

Old backup HTML files can expose outdated login behavior or stale public configuration. Keep them out of GitHub Pages and any public host.

## Required Supabase Setup

Run these SQL files before deploying the frontend:

1. `supabase_chiwa_course_schema.sql`
2. `supabase_security_hardening_20260525.sql`

Deploy these Edge Functions:

- `chiwa-secure-api`
- `chiwa-profile`
- `chiwa-history`
- `chiwa-voice`
- `chiwa-avatar`

Required Supabase Edge Function secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- voice provider API key
- avatar provider API key
- avatar Worker internal secret

Never put service role keys or provider API keys in `index.html`.

## Required Cloudflare Workers

Deploy:

- `cloudflare/ai-backend-worker`
- `cloudflare/avatar-r2-worker`

Required `ai-backend-worker` secrets and vars:

- secret: `ANTHROPIC_API_KEY`
- var: `ANTHROPIC_MODEL` optional
- var: `ALLOWED_ORIGIN=https://chiwaai.com`
- var: `SUPABASE_URL`
- var: `SUPABASE_ANON_KEY`

Required `avatar-r2-worker` secrets and vars:

- secret: `AVATAR_WORKER_INTERNAL_SECRET`
- secret: `URL_SIGNING_SECRET`
- R2 binding for the avatar bucket
- var: `ALLOWED_ORIGIN=https://chiwaai.com`

## Security Notes

- Frontend may contain Supabase anon key. That is normal and public.
- Frontend must never contain service role keys, voice provider keys, avatar provider keys, or Anthropic keys.
- The AI backend Worker validates the Supabase Auth token before calling Anthropic.
- Supabase Edge Function CORS is restricted to `https://chiwaai.com`.
- Generated voice and avatar files are stored in private buckets/R2 and delivered through signed URLs.

## Deployment Order

1. Apply SQL schema/hardening.
2. Deploy Supabase Edge Functions and set secrets.
3. Deploy Cloudflare Workers and set secrets/R2 bindings.
4. Upload static site files.
5. Test Google login, account positioning, AI generation, voice clone, avatar clone, generated history, course panel, and booking links.
