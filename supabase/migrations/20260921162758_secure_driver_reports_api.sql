-- Driver reports are served only by /api/driver-reports after this migration.
-- The server uses the service role and applies staff-session ownership rules.
alter table public.driver_reports enable row level security;

revoke all privileges on table public.driver_reports from anon;
revoke all privileges on table public.driver_reports from authenticated;
grant select, insert, update, delete on table public.driver_reports to service_role;

drop policy if exists driver_reports_select_anon on public.driver_reports;
drop policy if exists driver_reports_insert_anon on public.driver_reports;
drop policy if exists driver_reports_update_anon on public.driver_reports;
drop policy if exists driver_reports_delete_anon on public.driver_reports;
