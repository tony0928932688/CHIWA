create table if not exists public.vsl_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  source text not null default 'homepage_vsl_gate',
  page_url text,
  attribution jsonb not null default '{}'::jsonb,
  user_agent text,
  referer text,
  status text not null default 'submitted',
  created_at timestamptz not null default now()
);

create index if not exists vsl_leads_created_at_idx on public.vsl_leads (created_at desc);
create index if not exists vsl_leads_email_idx on public.vsl_leads (lower(email));

alter table public.vsl_leads enable row level security;

revoke all on table public.vsl_leads from anon;
revoke all on table public.vsl_leads from authenticated;
