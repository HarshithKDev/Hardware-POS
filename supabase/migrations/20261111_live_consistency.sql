-- =====================================================================
-- Hardware-POS: keep every device's copy of the catalog in step
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction (all or nothing); safe to run again.
-- =====================================================================
begin;

-- 1. "Last changed" times are always set by the database clock, never by a device.
--    (Devices only download products whose time moved, so a wrong or missing time
--    meant a device could show old stock/prices until its 6-hourly full refresh.)
create or replace function public.pos_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pos_product_touch on public.product_master;
create trigger pos_product_touch
  before insert or update on public.product_master
  for each row execute function public.pos_touch_updated_at();

drop trigger if exists pos_batch_touch on public.inventory_batches;
create trigger pos_batch_touch
  before insert or update on public.inventory_batches
  for each row execute function public.pos_touch_updated_at();

-- 2. Any change to a batch (sale, receipt, transfer, return, scrap, price edit, delete)
--    marks its product as changed, so every device picks it up.
--    Runs with the table owner's rights so it works for staff logins too.
create or replace function public.pos_bump_product_from_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.product_master
       set updated_at = now()
     where shop_id = new.shop_id and barcode = new.barcode;
  end if;
  if tg_op = 'DELETE'
     or (tg_op = 'UPDATE' and (old.barcode is distinct from new.barcode or old.shop_id is distinct from new.shop_id)) then
    update public.product_master
       set updated_at = now()
     where shop_id = old.shop_id and barcode = old.barcode;
  end if;
  return null;
end;
$$;

drop trigger if exists pos_batch_bumps_product on public.inventory_batches;
create trigger pos_batch_bumps_product
  after insert or update or delete on public.inventory_batches
  for each row execute function public.pos_bump_product_from_batch();

-- 3. Send live change notifications for sales, expenses and audit logs (not only
--    products), so the owner's screens refresh as soon as a counter makes a sale.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['product_master', 'inventory_batches', 'bills', 'expenses', 'audit_logs'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  else
    raise notice 'supabase_realtime publication not found - live notifications not changed';
  end if;
end $$;

commit;
