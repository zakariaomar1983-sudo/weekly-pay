create table if not exists public.roster (
  id text primary key,
  driver_name text not null default '',
  truck_number text not null default '',
  run_type text not null default 'Day Run',
  shift_date date,
  shift_time text not null default '',
  route text not null default '',
  status text not null default 'Scheduled',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.roster
  add column if not exists driver_name text not null default '',
  add column if not exists truck_number text not null default '',
  add column if not exists run_type text not null default 'Day Run',
  add column if not exists shift_date date,
  add column if not exists shift_time text not null default '',
  add column if not exists route text not null default '',
  add column if not exists status text not null default 'Scheduled',
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists roster_shift_date_idx on public.roster (shift_date desc);
create index if not exists roster_driver_name_idx on public.roster (driver_name);
create index if not exists roster_truck_number_idx on public.roster (truck_number);

create or replace function public.set_roster_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_roster_updated_at on public.roster;
create trigger set_roster_updated_at
before update on public.roster
for each row
execute function public.set_roster_updated_at();

grant select, insert, update, delete on table public.roster to anon;

alter table public.roster enable row level security;

drop policy if exists "roster_select_anon" on public.roster;
create policy "roster_select_anon"
on public.roster
for select
to anon
using (true);

drop policy if exists "roster_insert_anon" on public.roster;
create policy "roster_insert_anon"
on public.roster
for insert
to anon
with check (true);

drop policy if exists "roster_update_anon" on public.roster;
create policy "roster_update_anon"
on public.roster
for update
to anon
using (true)
with check (true);

drop policy if exists "roster_delete_anon" on public.roster;
create policy "roster_delete_anon"
on public.roster
for delete
to anon
using (true);
