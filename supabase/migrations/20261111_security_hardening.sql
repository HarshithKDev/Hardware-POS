-- =====================================================================
-- Hardware-POS: database security hardening
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction (all or nothing). Safe to run again.
-- No sales, stock or expense data is changed (except: expenses with no shop
-- are attached to your shop when there is exactly one shop in the database).
--
-- What it does
--  1. Expenses: each shop sees only its own (was open to everyone).
--  2. Product/batch views: follow the shop rules (were readable by anyone).
--  3. Staff list: before login only names are visible; full details only to
--     your own shop; only the owner can add/change/remove staff.
--  4. Shop settings: only the owner can change them.
--  5. Audit logs: can be added and read, never edited or deleted.
--  6. Returns / cash register records: own shop only.
--  7. Database functions: not callable by logged-out visitors; two unused
--     old functions locked.
--  8. Shop logos: only the uploader / shop owner can replace or delete.
--  9. Housekeeping: remove TRUNCATE/TRIGGER/REFERENCES and logged-out write
--     access on all tables.
-- =====================================================================
begin;

-- 0. Prerequisite: the shop helper used by every rule must exist
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'get_current_shop_id' and pronamespace = 'public'::regnamespace) then
    raise exception 'get_current_shop_id() not found. Nothing was changed.';
  end if;
end $$;

-- Helper: is the signed-in user the owner of their shop? (owner = admin email)
create or replace function public.pos_is_shop_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_settings s
    where s.id = public.get_current_shop_id()
      and trim(lower(s.admin_email)) = trim(lower(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;
revoke execute on function public.pos_is_shop_owner() from public, anon;
grant execute on function public.pos_is_shop_owner() to authenticated;

-- ---------------------------------------------------------------------
-- 1. Expenses
-- ---------------------------------------------------------------------
alter table public.expenses add column if not exists shop_id uuid;
do $$
declare
  v_shops int;
  v_shop uuid;
  v_left int;
begin
  select count(*) into v_shops from public.shop_settings;
  if v_shops = 1 then
    select id into v_shop from public.shop_settings limit 1;
    update public.expenses set shop_id = v_shop where shop_id is null;
  end if;
  select count(*) into v_left from public.expenses where shop_id is null;
  if v_left > 0 then
    raise notice '% expense(s) have no shop and will be hidden until a shop is set on them', v_left;
  end if;
end $$;
alter table public.expenses alter column shop_id set default public.get_current_shop_id();
alter table public.expenses enable row level security;
drop policy if exists "Allow all on expenses" on public.expenses;
drop policy if exists "expenses_own_shop" on public.expenses;
create policy "expenses_own_shop" on public.expenses
  for all to authenticated
  using (shop_id = public.get_current_shop_id())
  with check (shop_id = public.get_current_shop_id());

-- ---------------------------------------------------------------------
-- 2. Views used by staff devices: apply the table rules of the person asking
-- ---------------------------------------------------------------------
do $$
declare v text;
begin
  foreach v in array array['product_master_public', 'inventory_batches_public'] loop
    if exists (select 1 from pg_class c where c.relname = v and c.relnamespace = 'public'::regnamespace and c.relkind = 'v') then
      execute format('alter view public.%I set (security_invoker = true)', v);
      execute format('revoke all on public.%I from anon', v);
      execute format('revoke insert, update, delete, truncate, trigger, references on public.%I from authenticated', v);
      execute format('grant select on public.%I to authenticated', v);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Staff (workers)
-- ---------------------------------------------------------------------
-- Before login the staff dropdown needs names only (per shop).
drop policy if exists "Allow public read access to workers for login" on public.workers;
drop policy if exists "workers_login_names" on public.workers;
create policy "workers_login_names" on public.workers
  for select to anon
  using (true);
revoke all on public.workers from anon;
grant select (name, shop_id) on public.workers to anon;

-- Signed-in users: read own shop's staff; only the owner adds/changes/removes staff.
drop policy if exists "SaaS Isolation" on public.workers;
drop policy if exists "workers_read_own_shop" on public.workers;
drop policy if exists "workers_owner_insert" on public.workers;
drop policy if exists "workers_owner_update" on public.workers;
drop policy if exists "workers_owner_delete" on public.workers;
create policy "workers_read_own_shop" on public.workers
  for select to authenticated
  using (shop_id = public.get_current_shop_id());
create policy "workers_owner_insert" on public.workers
  for insert to authenticated
  with check (shop_id = public.get_current_shop_id() and public.pos_is_shop_owner());
create policy "workers_owner_update" on public.workers
  for update to authenticated
  using (shop_id = public.get_current_shop_id() and public.pos_is_shop_owner())
  with check (shop_id = public.get_current_shop_id() and public.pos_is_shop_owner());
create policy "workers_owner_delete" on public.workers
  for delete to authenticated
  using (shop_id = public.get_current_shop_id() and public.pos_is_shop_owner());

-- ---------------------------------------------------------------------
-- 4. Shop settings: staff may read (shop name, receipt details); only the owner changes them
-- ---------------------------------------------------------------------
drop policy if exists "Owner Read/Update Shop (Update)" on public.shop_settings;
drop policy if exists "shop_settings_owner_update" on public.shop_settings;
create policy "shop_settings_owner_update" on public.shop_settings
  for update to authenticated
  using (trim(lower(admin_email)) = trim(lower(coalesce(auth.jwt() ->> 'email', ''))))
  with check (trim(lower(admin_email)) = trim(lower(coalesce(auth.jwt() ->> 'email', ''))));

-- ---------------------------------------------------------------------
-- 5. Audit logs: add and read only (no edits or deletes from the app side)
-- ---------------------------------------------------------------------
drop policy if exists "SaaS Isolation" on public.audit_logs;
drop policy if exists "audit_logs_read_own_shop" on public.audit_logs;
drop policy if exists "audit_logs_add_own_shop" on public.audit_logs;
create policy "audit_logs_read_own_shop" on public.audit_logs
  for select to authenticated
  using (shop_id = public.get_current_shop_id());
create policy "audit_logs_add_own_shop" on public.audit_logs
  for insert to authenticated
  with check (shop_id = public.get_current_shop_id());
revoke update, delete on public.audit_logs from authenticated;

-- ---------------------------------------------------------------------
-- 6. Returns and cash-register records: own shop only
--    (returns are written by pos_return_items, which runs with owner rights)
-- ---------------------------------------------------------------------
drop policy if exists "returns_insert" on public.returns;
drop policy if exists "returns_select" on public.returns;
drop policy if exists "returns_own_shop" on public.returns;
create policy "returns_own_shop" on public.returns
  for select to authenticated
  using (shop_id = public.get_current_shop_id());

drop policy if exists "return_items_insert" on public.return_items;
drop policy if exists "return_items_select" on public.return_items;
drop policy if exists "return_items_own_shop" on public.return_items;
create policy "return_items_own_shop" on public.return_items
  for select to authenticated
  using (exists (select 1 from public.returns r where r.id = return_items.return_id and r.shop_id = public.get_current_shop_id()));

drop policy if exists "register_sessions_insert" on public.register_sessions;
drop policy if exists "register_sessions_select" on public.register_sessions;
drop policy if exists "register_sessions_update" on public.register_sessions;
drop policy if exists "register_sessions_own_shop" on public.register_sessions;
do $$
begin
  -- not used by the app yet; if it has a shop column, own shop only, otherwise closed
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'register_sessions' and column_name = 'shop_id') then
    execute 'create policy "register_sessions_own_shop" on public.register_sessions for all to authenticated
             using (shop_id = public.get_current_shop_id()) with check (shop_id = public.get_current_shop_id())';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Functions: nobody logged-out can call them; signed-in users keep access,
--    except two old unused functions.
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute 'revoke execute on function ' || f.sig || ' from public, anon';
    if f.proname in ('process_return', 'close_register', 'process_pos_transaction_unsafe') then
      execute 'revoke execute on function ' || f.sig || ' from authenticated';
    else
      execute 'grant execute on function ' || f.sig || ' to authenticated';
    end if;
  end loop;
end $$;
-- functions created later are not callable by logged-out visitors by default
alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------
-- 8. Shop logos (storage): anyone may view; only the uploader or the shop owner
--    may replace/delete (file names start with the shop id or owner email).
-- ---------------------------------------------------------------------
drop policy if exists "Users can update own logos" on storage.objects;
drop policy if exists "Users can delete own logos" on storage.objects;
drop policy if exists "logos_update_own" on storage.objects;
drop policy if exists "logos_delete_own" on storage.objects;
create policy "logos_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'shop-logos' and (
    owner = auth.uid()
    or (public.pos_is_shop_owner() and name like replace(public.get_current_shop_id()::text, '-', '_') || '.%')
  ))
  with check (bucket_id = 'shop-logos');
create policy "logos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'shop-logos' and owner = auth.uid());

-- ---------------------------------------------------------------------
-- 9. Housekeeping on all tables
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.relname);
    if t.relname <> 'workers' then
      execute format('revoke all on public.%I from anon', t.relname);
    end if;
  end loop;
end $$;

commit;

-- Result (read-only): the new rules, plus a count of expenses that have no shop
select 'rule' as kind, tablename || ' :: ' || policyname as item, cmd || ' for ' || array_to_string(roles, ',') as detail
from pg_policies
where schemaname = 'public' and tablename in ('expenses', 'workers', 'shop_settings', 'audit_logs', 'returns', 'return_items', 'register_sessions')
union all
select 'check', 'expenses without a shop (hidden)', count(*)::text from public.expenses where shop_id is null
order by kind desc, item;
