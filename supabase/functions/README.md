# Supabase Edge Functions

These production Edge Functions are deployed in project `nsauscojruqjcprvsfsn`.

- `chiwa-secure-api`: validates Supabase Auth JWT, returns the current student profile, performs 30-day quota resets, and deducts `ai_usage`, `voice_seconds`, or `avatar_seconds`.
- `cartesia-voice`: validates Supabase Auth JWT, proxies Cartesia voice clone/TTS operations, and keeps Cartesia keys out of the frontend.
- `runninghub-avatar`: validates Supabase Auth JWT, uploads the student's video/audio to RunningHub, starts AI app `1928389791241650178`, queries task status, and deducts `avatar_seconds` after a successful task.

Required function secrets:

- `CARTESIA_API_KEY`
- `RUNNINGHUB_API_KEY`
- Supabase managed secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

Never put provider API keys in `index.html`.
