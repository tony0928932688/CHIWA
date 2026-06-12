-- CHIWA LINE login support.
-- Run this once in Supabase SQL Editor before enabling LINE login for students.

alter table public.students
  add column if not exists line_user_id text,
  add column if not exists line_auth_uid text,
  add column if not exists line_display_name text,
  add column if not exists line_picture_url text,
  add column if not exists line_enabled boolean not null default false;

create unique index if not exists students_line_user_id_unique
  on public.students (line_user_id)
  where line_user_id is not null and line_user_id <> '';

create unique index if not exists students_line_auth_uid_unique
  on public.students (line_auth_uid)
  where line_auth_uid is not null and line_auth_uid <> '';

create or replace function private.current_auth_email()
returns text
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select lower(coalesce(auth.email(), ''));
$$;

create or replace function private.current_auth_uid()
returns text
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(auth.uid()::text, '');
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
    where (
        (
          private.current_auth_email() <> ''
          and (
            private.current_auth_email() = lower(coalesce(s.google_email, ''))
            or private.current_auth_email() = lower(coalesce(s.email, ''))
            or private.current_auth_email() = lower(coalesce(s.id, ''))
          )
        )
        or (
          private.current_auth_uid() <> ''
          and private.current_auth_uid() = coalesce(s.line_auth_uid, '')
          and coalesce(s.line_enabled, false) = true
        )
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
  where (
      (
        private.current_auth_email() <> ''
        and (
          private.current_auth_email() = lower(coalesce(s.google_email, ''))
          or private.current_auth_email() = lower(coalesce(s.email, ''))
          or private.current_auth_email() = lower(coalesce(s.id, ''))
        )
      )
      or (
        private.current_auth_uid() <> ''
        and private.current_auth_uid() = coalesce(s.line_auth_uid, '')
        and coalesce(s.line_enabled, false) = true
      )
    )
    and coalesce(s.google_enabled, true) = true
    and coalesce(s.status, '正常') = '正常'
  order by coalesce(s.is_admin, false) desc
  limit 1;
$$;
