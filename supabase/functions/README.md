# Supabase Edge Functions

These production Edge Functions are deployed in project `nsauscojruqjcprvsfsn`.

- `chiwa-secure-api`: validates Supabase Auth JWT, returns the current student profile, performs 30-day quota resets, and deducts `ai_usage`, `voice_seconds`, or `avatar_seconds`.
- `chiwa-voice`: validates Supabase Auth JWT, proxies voice clone/TTS operations, and keeps vendor keys out of the frontend.
- `chiwa-avatar`: validates Supabase Auth JWT, starts avatar generation, transfers completed videos into private object storage, signs short-lived preview/download URLs, and deducts `avatar_seconds` after a successful task.

Required function secrets:

- Voice provider API key
- Avatar provider API key
- Supabase managed secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

Never put provider API keys in `index.html`.
