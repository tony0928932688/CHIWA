-- CHIWA production security hardening applied on 2026-05-25.
-- Project: nsauscojruqjcprvsfsn
-- Purpose: protect student data behind Supabase Auth + Edge Functions.

create schema if not exists private;

create or replace function private.current_auth_email()
returns text
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select lower(coalesce(auth.email(), ''));
$$;

create or replace function private.is_admin_email()
returns boolean
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.students s
    where private.current_auth_email() <> ''
      and (
        private.current_auth_email() = lower(coalesce(s.google_email, ''))
        or private.current_auth_email() = lower(coalesce(s.email, ''))
        or private.current_auth_email() = lower(coalesce(s.id, ''))
      )
      and coalesce(s.google_enabled, true) = true
      and coalesce(s.is_admin, false) = true
      and coalesce(s.status, '正常') = '正常'
  );
$$;

create or replace function private.current_student_id()
returns text
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select s.id
  from public.students s
  where private.current_auth_email() <> ''
    and (
      private.current_auth_email() = lower(coalesce(s.google_email, ''))
      or private.current_auth_email() = lower(coalesce(s.email, ''))
      or private.current_auth_email() = lower(coalesce(s.id, ''))
    )
    and coalesce(s.google_enabled, true) = true
    and coalesce(s.status, '正常') = '正常'
  order by coalesce(s.is_admin, false) desc
  limit 1;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.students enable row level security;
drop policy if exists allow_all on public.students;
drop policy if exists students_select_self_or_admin on public.students;
drop policy if exists students_admin_insert on public.students;
drop policy if exists students_admin_update on public.students;
drop policy if exists students_admin_delete on public.students;

create policy students_select_self_or_admin on public.students
  for select to authenticated
  using (
    private.is_admin_email()
    or (
      private.current_auth_email() <> ''
      and (
        private.current_auth_email() = lower(coalesce(google_email, ''))
        or private.current_auth_email() = lower(coalesce(email, ''))
        or private.current_auth_email() = lower(coalesce(id, ''))
      )
      and coalesce(google_enabled, true) = true
      and coalesce(status, '正常') = '正常'
    )
  );

create policy students_admin_insert on public.students
  for insert to authenticated
  with check (private.is_admin_email());

create policy students_admin_update on public.students
  for update to authenticated
  using (private.is_admin_email())
  with check (private.is_admin_email());

create policy students_admin_delete on public.students
  for delete to authenticated
  using (private.is_admin_email());

drop policy if exists site_settings_admin_write on public.site_settings;
create policy site_settings_admin_write on public.site_settings
  for all to authenticated
  using (private.is_admin_email())
  with check (private.is_admin_email());

drop policy if exists course_progress_owner_read on public.course_progress;
drop policy if exists course_progress_owner_write on public.course_progress;

create policy course_progress_owner_read on public.course_progress
  for select to authenticated
  using (
    private.is_admin_email()
    or student_id = private.current_student_id()
  );

create policy course_progress_owner_write on public.course_progress
  for all to authenticated
  using (
    private.is_admin_email()
    or student_id = private.current_student_id()
  )
  with check (
    private.is_admin_email()
    or student_id = private.current_student_id()
  );

drop policy if exists system_voice_presets_service_only on public.system_voice_presets;
drop policy if exists voice_generations_service_only on public.voice_generations;
drop policy if exists voice_models_service_only on public.voice_models;

create policy system_voice_presets_service_only on public.system_voice_presets
  for all to authenticated
  using (false)
  with check (false);

create policy voice_generations_service_only on public.voice_generations
  for all to authenticated
  using (false)
  with check (false);

create policy voice_models_service_only on public.voice_models
  for all to authenticated
  using (false)
  with check (false);

revoke all on table public.system_voice_presets from anon, authenticated;
revoke all on table public.voice_generations from anon, authenticated;
revoke all on table public.voice_models from anon, authenticated;

update public.students
set password = 'GOOGLE_LOGIN_ONLY'
where password is distinct from 'GOOGLE_LOGIN_ONLY';

alter table public.students alter column password set default 'GOOGLE_LOGIN_ONLY';

-- AI quota expansion for RunningHub image/avatar clone.
alter table public.students
  add column if not exists avatar_seconds integer default 1800,
  add column if not exists quota_started_at timestamptz default now(),
  add column if not exists quota_reset_at timestamptz default (now() + interval '30 days');

update public.students
set avatar_seconds = coalesce(avatar_seconds, 1800),
    quota_started_at = coalesce(quota_started_at, created_at::timestamptz, now()),
    quota_reset_at = coalesce(quota_reset_at, coalesce(quota_started_at, created_at::timestamptz, now()) + interval '30 days');

create table if not exists public.avatar_generation_tasks (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  task_id text not null unique,
  status text not null default 'RUNNING',
  requested_seconds integer not null default 0,
  charged boolean not null default false,
  video_file text,
  audio_file text,
  result_url text,
  output_type text,
  error_code text,
  error_message text,
  usage jsonb not null default '{}'::jsonb,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.avatar_generation_tasks enable row level security;

drop trigger if exists set_avatar_generation_tasks_updated_at on public.avatar_generation_tasks;
create trigger set_avatar_generation_tasks_updated_at
before update on public.avatar_generation_tasks
for each row execute function public.set_updated_at();

drop policy if exists avatar_generation_tasks_service_only on public.avatar_generation_tasks;
create policy avatar_generation_tasks_service_only on public.avatar_generation_tasks
  for all to authenticated
  using (false)
  with check (false);

revoke all on table public.avatar_generation_tasks from anon, authenticated;

-- Private storage bucket for temporary RunningHub avatar clone inputs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatar-inputs',
  'avatar-inputs',
  false,
  1073741824,
  null
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatar_inputs_insert_own_folder on storage.objects;
drop policy if exists avatar_inputs_select_own_folder on storage.objects;
drop policy if exists avatar_inputs_update_own_folder on storage.objects;
drop policy if exists avatar_inputs_delete_own_folder on storage.objects;

create policy avatar_inputs_insert_own_folder on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatar-inputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatar_inputs_select_own_folder on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatar-inputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatar_inputs_update_own_folder on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatar-inputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatar-inputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatar_inputs_delete_own_folder on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatar-inputs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
