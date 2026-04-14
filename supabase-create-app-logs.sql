create extension if not exists pgcrypto;

create table if not exists public.app_logs (
  id uuid primary key default gen_random_uuid(),
  log_date date,
  log_type text not null default 'Operations',
  driver text not null default '',
  truck_number text not null default '',
  reference text not null default '',
  status text not null default 'Open',
  description text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists app_logs_log_date_idx on public.app_logs (log_date desc);
create index if not exists app_logs_status_idx on public.app_logs (status);

create or replace function public.set_app_logs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_app_logs_updated_at on public.app_logs;
create trigger set_app_logs_updated_at
before update on public.app_logs
for each row
execute function public.set_app_logs_updated_at();

alter table public.app_logs enable row level security;

drop policy if exists "app_logs_select_anon" on public.app_logs;
create policy "app_logs_select_anon"
on public.app_logs
for select
to anon
using (true);

drop policy if exists "app_logs_insert_anon" on public.app_logs;
create policy "app_logs_insert_anon"
on public.app_logs
for insert
to anon
with check (true);

drop policy if exists "app_logs_update_anon" on public.app_logs;
create policy "app_logs_update_anon"
on public.app_logs
for update
to anon
using (true)
with check (true);

drop policy if exists "app_logs_delete_anon" on public.app_logs;
create policy "app_logs_delete_anon"
on public.app_logs
for delete
to anon
using (true);
