-- Hardware-POS: database security check (READ-ONLY - changes nothing)
select section, object, detail from (
  -- 1. Is row-level security switched on for each table?
  select 1 as o, 'table'::text as section, c.relname::text as object,
         ('rls=' || c.relrowsecurity || ' forced=' || c.relforcerowsecurity)::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  union all
  -- 2. The rules (policies) on each table and on file storage
  select 2, 'policy', (schemaname || '.' || tablename || ' :: ' || policyname)::text,
         ('cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' permissive=' || permissive
          || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-'))::text
  from pg_policies where schemaname in ('public', 'storage')
  union all
  -- 3. What logged-out (anon) and logged-in (authenticated) users may do per table
  select 3, 'grant', table_name::text,
         (grantee::text || ': ' || string_agg(privilege_type::text, ',' order by privilege_type::text))::text
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee::text in ('anon', 'authenticated')
  group by table_name, grantee
  union all
  -- 4. Database functions: who can call them, and do they run with owner rights?
  select 4, 'function', p.oid::regprocedure::text,
         ('owner_rights=' || p.prosecdef
          || ' anon_can_call=' || has_function_privilege('anon', p.oid, 'EXECUTE')
          || ' auth_can_call=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
          || ' settings=' || coalesce(array_to_string(p.proconfig, ','), '-'))::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  -- 5. Views (they can bypass table rules unless security_invoker is on)
  select 5, 'view', c.relname::text, ('options=' || coalesce(array_to_string(c.reloptions, ','), '-'))::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
  union all
  -- 6. File storage buckets (logos): public or private?
  select 6, 'bucket', id::text, ('public=' || public)::text from storage.buckets
  union all
  -- 7. Tables that broadcast live changes
  select 7, 'realtime', (schemaname || '.' || tablename)::text, '-'
  from pg_publication_tables where pubname = 'supabase_realtime'
) x
order by o, object;
