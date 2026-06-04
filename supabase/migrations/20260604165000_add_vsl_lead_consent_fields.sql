alter table public.vsl_leads
  add column if not exists privacy_consent boolean not null default false,
  add column if not exists followup_consent boolean not null default false,
  add column if not exists consent_text text,
  add column if not exists consent_version text,
  add column if not exists consent_at timestamptz;

create index if not exists vsl_leads_followup_consent_idx
  on public.vsl_leads (followup_consent, created_at desc);
