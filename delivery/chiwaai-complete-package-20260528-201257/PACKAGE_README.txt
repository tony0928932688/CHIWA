CHIWAAI Complete Delivery Package
Created: 2026-05-28 20:12:59 +08:00

Included:
- index.html: live homepage + student workspace
- lazy-workflow-test.html: isolated lazy workflow test page
- privacy.html / terms.html
- assets/: logo and favicon
- CNAME / .nojekyll
- backend-source/supabase/functions
- backend-source/cloudflare workers
- database/*.sql

Excluded intentionally:
- .git
- dist/manual-gh-pages
- local caches / temp files
- real API keys and service role secrets

Important:
Do not put real provider keys into index.html or lazy-workflow-test.html.
Use Supabase Edge Function Secrets and Cloudflare Worker Secrets.
