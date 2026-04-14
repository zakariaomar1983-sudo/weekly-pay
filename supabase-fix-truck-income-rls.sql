begin;

grant usage on schema public to anon;
grant select, insert, update, delete on table public.truck_income to anon;

alter table public.truck_income enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'truck_income'
      and policyname = 'truck_income_anon_select'
  ) then
    create policy truck_income_anon_select
      on public.truck_income
      for select
      to anon
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'truck_income'
      and policyname = 'truck_income_anon_insert'
  ) then
    create policy truck_income_anon_insert
      on public.truck_income
      for insert
      to anon
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'truck_income'
      and policyname = 'truck_income_anon_update'
  ) then
    create policy truck_income_anon_update
      on public.truck_income
      for update
      to anon
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'truck_income'
      and policyname = 'truck_income_anon_delete'
  ) then
    create policy truck_income_anon_delete
      on public.truck_income
      for delete
      to anon
      using (true);
  end if;
end
$$;

commit;
