create extension if not exists pgcrypto;

create table if not exists public.driver_reports (
  id text primary key,
  driver_user_id text not null,
  driver_name text not null default '',
  report_date date not null,
  truck_number text not null default '',
  shift_start time,
  shift_finish time,
  job_client text not null default '',
  delivery_count integer not null default 0,
  fuel_used numeric not null default 0,
  vehicle_condition text not null default 'Good',
  issues text not null default '',
  notes text not null default '',
  status text not null default 'Draft',
  submitted_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.driver_reports add column if not exists submitted_at timestamptz;

create index if not exists driver_reports_date_idx on public.driver_reports (report_date desc);
create index if not exists driver_reports_driver_idx on public.driver_reports (driver_user_id);

alter table public.driver_reports enable row level security;
grant select, insert, update, delete on table public.driver_reports to anon;

drop policy if exists driver_reports_select_anon on public.driver_reports;
create policy driver_reports_select_anon on public.driver_reports for select to anon using (true);
drop policy if exists driver_reports_insert_anon on public.driver_reports;
create policy driver_reports_insert_anon on public.driver_reports for insert to anon with check (true);
drop policy if exists driver_reports_update_anon on public.driver_reports;
create policy driver_reports_update_anon on public.driver_reports for update to anon using (true) with check (true);
drop policy if exists driver_reports_delete_anon on public.driver_reports;
create policy driver_reports_delete_anon on public.driver_reports for delete to anon using (true);
