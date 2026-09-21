-- Pin trigger helpers to trusted schemas so object resolution cannot be
-- influenced by a caller-controlled search_path.
alter function public.set_roster_updated_at() set search_path = pg_catalog, public;
alter function public.set_app_logs_updated_at() set search_path = pg_catalog, public;
alter function public.set_updated_at() set search_path = pg_catalog, public;

-- Cover foreign keys used during role updates/deletes and assignment cleanup.
create index if not exists auth_users_role_id_idx
  on public.auth_users (role_id);

create index if not exists control_panel_users_role_id_idx
  on public.control_panel_users (role_id);

create index if not exists staff_role_assignments_assigned_by_idx
  on public.staff_role_assignments (assigned_by);
