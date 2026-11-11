-- =====================================================================
-- Hardware-POS: protect cost prices, profit and stock (security part 2)
-- Run AFTER the app update "cost-protected reads" is live and every counter
-- has reloaded. Paste this whole file into Supabase -> SQL Editor -> Run.
-- One transaction (all or nothing). Safe to run again. No data is changed.
--
-- After this:
--  * Products, batches, bills and bill items: only the OWNER can read or change
--    the full tables (with cost prices and profit).
--  * Staff devices read cost-free copies (views) of their own shop:
--      product_master_public, inventory_batches_public, bills_public, bill_items_public
--  * Staff change stock and bills only through the database functions the app
--    already uses (sale, receive, move, return, scrap, open box).
--  * Categories: staff can read, only the owner can change.
--  * pos_events: a small "something changed" signal so staff screens still
--    refresh live (no prices in it).
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'get_current_shop_id' and pronamespace = 'public'::regnamespace) then
    raise exception 'get_current_shop_id() not found. Nothing was changed.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'pos_process_sale' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run 20261111_atomic_actions.sql first. Nothing was changed.';
  end if;
end $$;

-- Owner check (same as in the security hardening script; created here if missing)
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
-- 1. Cost-free views for staff: own shop only, every column except cost/profit
-- ---------------------------------------------------------------------
do $$
declare
  pair text[];
  cols text;
begin
  foreach pair slice 1 in array array[
    array['product_master', 'product_master_public'],
    array['inventory_batches', 'inventory_batches_public'],
    array['bills', 'bills_public'],
    array['bill_items', 'bill_items_public']
  ] loop
    select string_agg(format('%I', column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = pair[1]
      and column_name !~* '(cost|profit)';
    execute format('drop view if exists public.%I', pair[2]);
    execute format(
      'create view public.%I with (security_invoker = false) as select %s from public.%I where shop_id = public.get_current_shop_id()',
      pair[2], cols, pair[1]);
    execute format('revoke all on public.%I from public, anon', pair[2]);
    execute format('grant select on public.%I to authenticated', pair[2]);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Full tables: owner only
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['product_master', 'inventory_batches', 'bills', 'bill_items'] loop
    execute format('drop policy if exists "SaaS Isolation" on public.%I', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_only', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (shop_id = public.get_current_shop_id() and (select public.pos_is_shop_owner()))
         with check (shop_id = public.get_current_shop_id() and (select public.pos_is_shop_owner()))',
      t || '_owner_only', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Categories: everyone in the shop reads, only the owner changes
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categories', 'subcategories'] loop
    execute format('drop policy if exists "SaaS Isolation" on public.%I', t);
    execute format('drop policy if exists %I on public.%I', t || '_read_own_shop', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (shop_id = public.get_current_shop_id())', t || '_read_own_shop', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (shop_id = public.get_current_shop_id() and (select public.pos_is_shop_owner()))', t || '_owner_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (shop_id = public.get_current_shop_id() and (select public.pos_is_shop_owner())) with check (shop_id = public.get_current_shop_id() and (select public.pos_is_shop_owner()))', t || '_owner_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (shop_id = public.get_current_shop_id() and (select public.pos_is_shop_owner()))', t || '_owner_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. pos_events: cost-free "something changed" signal for live refresh
-- ---------------------------------------------------------------------
create table if not exists public.pos_events (
  id bigserial primary key,
  shop_id uuid not null,
  kind text not null,          -- 'product' | 'batch' | 'bill'
  op text,                     -- INSERT | UPDATE | DELETE
  ref text,                    -- barcode (product/batch) or bill id
  created_at timestamptz not null default now()
);
create index if not exists pos_events_created_at_idx on public.pos_events (created_at);
alter table public.pos_events enable row level security;
drop policy if exists "pos_events_read_own_shop" on public.pos_events;
create policy "pos_events_read_own_shop" on public.pos_events
  for select to authenticated using (shop_id = public.get_current_shop_id());
revoke all on public.pos_events from public, anon, authenticated;
grant select on public.pos_events to authenticated;

create or replace function public.pos_emit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_kind text;
  v_ref text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if r.shop_id is null then return null; end if;
  if tg_table_name = 'product_master' then
    v_kind := 'product'; v_ref := r.barcode::text;
  elsif tg_table_name = 'inventory_batches' then
    v_kind := 'batch'; v_ref := r.barcode::text;
  else
    v_kind := 'bill'; v_ref := r.id::text;
  end if;
  insert into public.pos_events (shop_id, kind, op, ref) values (r.shop_id, v_kind, tg_op, v_ref);
  -- keep the table small: now and then remove signals older than 2 days
  if random() < 0.02 then
    delete from public.pos_events where created_at < now() - interval '2 days';
  end if;
  return null;
end $$;
revoke execute on function public.pos_emit_event() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['product_master', 'inventory_batches', 'bills'] loop
    execute format('drop trigger if exists pos_emit_event_trg on public.%I', t);
    execute format('create trigger pos_emit_event_trg after insert or update or delete on public.%I for each row execute function public.pos_emit_event()', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pos_events') then
    execute 'alter publication supabase_realtime add table public.pos_events';
  end if;
end $$;

commit;

-- Result (read-only): the rules now on these tables
select tablename as "table", policyname as rule, cmd as action
from pg_policies
where schemaname = 'public'
  and tablename in ('product_master', 'inventory_batches', 'bills', 'bill_items', 'categories', 'subcategories', 'pos_events')
order by tablename, policyname;
