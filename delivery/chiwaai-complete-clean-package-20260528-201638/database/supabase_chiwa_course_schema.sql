-- 吉娃 AI 課程保存、觀看進度與 Google 登入支援
-- 已於 2026-05-24 套用到 nsauscojruqjcprvsfsn。
-- 若未來重建 Supabase 專案，可重新執行此檔。

alter table public.students
  add column if not exists google_email text,
  add column if not exists google_enabled boolean default false,
  add column if not exists status text default '正常',
  add column if not exists note text default '',
  add column if not exists reg_date text default '';

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.course_progress (
  student_id text not null,
  lesson_id text not null,
  progress_seconds integer not null default 0,
  duration_seconds integer not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (student_id, lesson_id)
);

alter table public.site_settings enable row level security;
alter table public.course_progress enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_site_settings_updated_at on public.site_settings;
create trigger set_site_settings_updated_at
before update on public.site_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_course_progress_updated_at on public.course_progress;
create trigger set_course_progress_updated_at
before update on public.course_progress
for each row execute function public.set_updated_at();

drop policy if exists site_settings_read_all on public.site_settings;
create policy site_settings_read_all on public.site_settings
  for select to public using (true);

drop policy if exists site_settings_admin_write on public.site_settings;
create policy site_settings_admin_write on public.site_settings
  for all to authenticated
  using (exists (
    select 1 from public.students s
    where lower(s.google_email) = lower(auth.email())
      and coalesce(s.google_enabled, false) = true
      and coalesce(s.is_admin, false) = true
      and coalesce(s.status, '正常') <> '已停權'
  ))
  with check (exists (
    select 1 from public.students s
    where lower(s.google_email) = lower(auth.email())
      and coalesce(s.google_enabled, false) = true
      and coalesce(s.is_admin, false) = true
      and coalesce(s.status, '正常') <> '已停權'
  ));

drop policy if exists course_progress_owner_read on public.course_progress;
create policy course_progress_owner_read on public.course_progress
  for select to authenticated
  using (exists (
    select 1 from public.students s
    where s.id = course_progress.student_id
      and lower(s.google_email) = lower(auth.email())
      and coalesce(s.google_enabled, false) = true
      and coalesce(s.status, '正常') <> '已停權'
  ) or exists (
    select 1 from public.students s
    where lower(s.google_email) = lower(auth.email())
      and coalesce(s.google_enabled, false) = true
      and coalesce(s.is_admin, false) = true
      and coalesce(s.status, '正常') <> '已停權'
  ));

drop policy if exists course_progress_owner_write on public.course_progress;
create policy course_progress_owner_write on public.course_progress
  for all to authenticated
  using (exists (
    select 1 from public.students s
    where s.id = course_progress.student_id
      and lower(s.google_email) = lower(auth.email())
      and coalesce(s.google_enabled, false) = true
      and coalesce(s.status, '正常') <> '已停權'
  ) or exists (
    select 1 from public.students s
    where lower(s.google_email) = lower(auth.email())
      and coalesce(s.google_enabled, false) = true
      and coalesce(s.is_admin, false) = true
      and coalesce(s.status, '正常') <> '已停權'
  ))
  with check (exists (
    select 1 from public.students s
    where s.id = course_progress.student_id
      and lower(s.google_email) = lower(auth.email())
      and coalesce(s.google_enabled, false) = true
      and coalesce(s.status, '正常') <> '已停權'
  ) or exists (
    select 1 from public.students s
    where lower(s.google_email) = lower(auth.email())
      and coalesce(s.google_enabled, false) = true
      and coalesce(s.is_admin, false) = true
      and coalesce(s.status, '正常') <> '已停權'
  ));
