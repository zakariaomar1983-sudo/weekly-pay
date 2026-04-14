alter table public.drivers
add column if not exists email text;

comment on column public.drivers.email is 'Shared driver email address used for email contact actions in the CRM.';
