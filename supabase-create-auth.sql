create table if not exists public.auth_roles (
  id text primary key,
  name text not null,
  system boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.auth_users (
  id text primary key,
  username text not null unique,
  password text not null,
  role_id text not null,
  active boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists auth_users_username_idx on public.auth_users (lower(username));
create index if not exists auth_users_role_id_idx on public.auth_users (role_id);

create or replace function public.set_auth_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_auth_roles_updated_at on public.auth_roles;
create trigger set_auth_roles_updated_at
before update on public.auth_roles
for each row
execute function public.set_auth_updated_at();

drop trigger if exists set_auth_users_updated_at on public.auth_users;
create trigger set_auth_users_updated_at
before update on public.auth_users
for each row
execute function public.set_auth_updated_at();

alter table public.auth_roles enable row level security;
alter table public.auth_users enable row level security;

drop policy if exists "auth_roles_select_anon" on public.auth_roles;
create policy "auth_roles_select_anon"
on public.auth_roles
for select
to anon
using (true);

drop policy if exists "auth_roles_insert_anon" on public.auth_roles;
create policy "auth_roles_insert_anon"
on public.auth_roles
for insert
to anon
with check (true);

drop policy if exists "auth_roles_update_anon" on public.auth_roles;
create policy "auth_roles_update_anon"
on public.auth_roles
for update
to anon
using (true)
with check (true);

drop policy if exists "auth_roles_delete_anon" on public.auth_roles;
create policy "auth_roles_delete_anon"
on public.auth_roles
for delete
to anon
using (true);

drop policy if exists "auth_users_select_anon" on public.auth_users;
create policy "auth_users_select_anon"
on public.auth_users
for select
to anon
using (true);

drop policy if exists "auth_users_insert_anon" on public.auth_users;
create policy "auth_users_insert_anon"
on public.auth_users
for insert
to anon
with check (true);

drop policy if exists "auth_users_update_anon" on public.auth_users;
create policy "auth_users_update_anon"
on public.auth_users
for update
to anon
using (true)
with check (true);

drop policy if exists "auth_users_delete_anon" on public.auth_users;
create policy "auth_users_delete_anon"
on public.auth_users
for delete
to anon
using (true);
