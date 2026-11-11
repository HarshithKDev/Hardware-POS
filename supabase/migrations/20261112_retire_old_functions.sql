-- =====================================================================
-- Hardware-POS: retire old functions  (run this the DAY AFTER the others,
-- once every counter has reloaded the app)
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction (all or nothing); safe to run again. No business data is changed.
-- =====================================================================
begin;

-- 0. Stop with a clear message if the earlier scripts have not been run yet
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'pos_process_sale' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run 20261111_atomic_actions.sql first, and this script the next day. Nothing was changed.';
  end if;
end $$;

-- 1. Nobody can call the old sale function directly any more, so its checks
--    (billable staff, MSP, one-bill-per-checkout) can't be bypassed.
--    pos_process_sale still uses it internally (it runs as the database owner).
revoke execute on function public.process_pos_transaction_unsafe(text, text, text, jsonb) from public, anon, authenticated;

-- The old "safe" wrappers never worked (they check a workers.is_billable column
-- that does not exist) and are replaced by pos_process_sale.
drop function if exists public.process_pos_transaction(text, text, text, jsonb);
drop function if exists public.process_pos_transaction(text, text, text, text, numeric, numeric, jsonb);

-- 2. Drop old functions that refer to a table that no longer exists ("inventory")
--    or are unused. Each one is only dropped if no trigger uses it; otherwise it is
--    kept and a notice is shown.
do $$
declare
  f record;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'decrement_stock',
        'handle_inventory_action',
        'process_inventory_action',
        'update_inventory_quantity_from_pieces',
        'adjust_batch_stock',
        'toggle_stock_instance'
      )
  loop
    if exists (select 1 from pg_trigger t where t.tgfoid = f.oid) then
      raise notice 'Kept % (a trigger still uses it)', f.sig;
    else
      execute 'drop function ' || f.sig;
      raise notice 'Dropped %', f.sig;
    end if;
  end loop;
end $$;

commit;
