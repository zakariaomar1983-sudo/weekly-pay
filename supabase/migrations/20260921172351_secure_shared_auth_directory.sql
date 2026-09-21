-- Shared credentials are now read and managed only by server-side APIs.
alter table public.auth_users enable row level security;
alter table public.auth_roles enable row level security;

revoke all privileges on table public.auth_users from anon;
revoke all privileges on table public.auth_users from authenticated;
revoke all privileges on table public.auth_roles from anon;
revoke all privileges on table public.auth_roles from authenticated;

grant select, insert, update, delete on table public.auth_users to service_role;
grant select, insert, update, delete on table public.auth_roles to service_role;

drop policy if exists "Allow all auth_users" on public.auth_users;
drop policy if exists allow_all_auth_users on public.auth_users;
drop policy if exists "Allow all auth_roles" on public.auth_roles;
drop policy if exists allow_all_auth_roles on public.auth_roles;

-- These helpers are used by authenticated RLS policies. Keep that legitimate
-- access, but remove the default PUBLIC/anonymous execution path and pin the
-- lookup path so a caller cannot substitute objects from another schema.
alter function public.is_admin() set search_path = pg_catalog, public;
alter function public.has_control_permission(text) set search_path = pg_catalog, public;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.has_control_permission(text) from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.has_control_permission(text) to authenticated, service_role;
