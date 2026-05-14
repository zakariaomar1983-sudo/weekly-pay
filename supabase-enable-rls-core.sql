begin;

grant usage on schema public to anon, authenticated;

do $$
declare
  t text;
  r text;
  op text;
  tables text[] := array[
    'trucks',
    'truck_expense',
    'payslips',
    'members',
    'auth_users',
    'auth_roles'
  ];
  roles text[] := array['anon', 'authenticated'];
  ops text[] := array['select', 'insert', 'update', 'delete'];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format(
        'grant select, insert, update, delete on table public.%I to anon, authenticated',
        t
      );

      foreach r in array roles loop
        foreach op in array ops loop
          if not exists (
            select 1
            from pg_policies
            where schemaname = 'public'
              and tablename = t
              and policyname = format('opx_%s_%s_%s', t, r, op)
          ) then
            if op = 'select' then
              execute format(
                'create policy %I on public.%I for select to %I using (true)',
                format('opx_%s_%s_%s', t, r, op),
                t,
                r
              );
            elsif op = 'insert' then
              execute format(
                'create policy %I on public.%I for insert to %I with check (true)',
                format('opx_%s_%s_%s', t, r, op),
                t,
                r
              );
            elsif op = 'update' then
              execute format(
                'create policy %I on public.%I for update to %I using (true) with check (true)',
                format('opx_%s_%s_%s', t, r, op),
                t,
                r
              );
            elsif op = 'delete' then
              execute format(
                'create policy %I on public.%I for delete to %I using (true)',
                format('opx_%s_%s_%s', t, r, op),
                t,
                r
              );
            end if;
          end if;
        end loop;
      end loop;
    end if;
  end loop;
end
$$;

commit;
