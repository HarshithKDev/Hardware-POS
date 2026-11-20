-- =====================================================================
-- Hardware-POS: free screws
-- Paste this whole file into Supabase -> SQL Editor and click Run.
-- One transaction (all or nothing); safe to run again. No existing data is changed.
--
-- 1. bill_items.free_amount: rupees of screws given free on a bill (the line itself is ₹0,
--    so it never counts in the bill total, revenue or payments).
-- 2. Staff view bill_items_public rebuilt so it includes the new column.
-- 3. pos_process_sale(...) gets p_screw_free_amount: a free screws line is saved as
--    "Screws (FREE)" at ₹0 with free_amount set, and the bill's audit line mentions it.
-- Apps not yet updated keep working: they call the function without the new argument.
-- =====================================================================
begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'pos_process_sale' and pronamespace = 'public'::regnamespace) then
    raise exception 'Run 20261111_atomic_actions.sql, 20261111_audit_completeness.sql and 20261115_stock_billno_staff.sql first. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Free amount on bill lines
-- ---------------------------------------------------------------------
alter table public.bill_items add column if not exists free_amount numeric;

-- ---------------------------------------------------------------------
-- 2. Staff view (same rules as 20261111_cost_protection.sql: every column except cost/profit)
-- ---------------------------------------------------------------------
do $$
declare
  cols text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'bill_items'
    and column_name !~* '(cost|profit)';
  execute 'drop view if exists public.bill_items_public';
  execute format(
    'create view public.bill_items_public with (security_invoker = false) as select %s from public.bill_items where shop_id = public.get_current_shop_id()',
    cols);
  execute 'revoke all on public.bill_items_public from public, anon';
  execute 'grant select on public.bill_items_public to authenticated';
end $$;

-- ---------------------------------------------------------------------
-- 3. Sale function with the free screws amount. The old version is dropped first so the
--    API never has two candidates to choose between.
-- ---------------------------------------------------------------------
drop function if exists public.pos_process_sale(text, text, text, jsonb, text, numeric, numeric, numeric, text, text, numeric, text);

create or replace function public.pos_process_sale(
  p_action text,
  p_location text,
  p_cashier_name text,
  p_items jsonb,
  p_payment_method text default null,
  p_cash_amount numeric default 0,
  p_upi_amount numeric default 0,
  p_total_amount numeric default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_screw_price numeric default null,
  p_client_ref text default null,
  p_screw_free_amount numeric default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid := get_current_shop_id();
  v_existing uuid;
  v_result json;
  v_bill uuid;
  v_item jsonb;
  v_msp numeric;
  v_price numeric;
  v_is_showroom boolean := (p_payment_method = 'SHOWROOM');
  v_total numeric;
  v_listed numeric;
  v_lines int;
  v_disc numeric;
  v_pay text;
  v_need record;
  v_batch public.inventory_batches%rowtype;
  v_no_warehouse boolean;
  v_move numeric;
  v_bill_no bigint;
begin
  if v_shop is null then
    raise exception 'Unable to determine shop_id. Are you logged in?';
  end if;

  -- Non-billable (helper) staff cannot bill customers
  if p_action = 'SALE' and exists (
    select 1 from public.workers where id = auth.uid() and password like '%NON_BILLABLE%'
  ) then
    raise exception 'This staff account is not allowed to bill customers.';
  end if;

  -- Same checkout sent twice (retry after a dropped connection): return the first bill
  if p_client_ref is not null then
    perform pg_advisory_xact_lock(hashtext(v_shop::text || ':' || p_client_ref));
    select id into v_existing from public.bills where shop_id = v_shop and client_ref = p_client_ref limit 1;
    if v_existing is not null then
      select bill_no into v_bill_no from public.bills where id = v_existing;
      return json_build_object('success', true, 'bill_id', v_existing, 'bill_no', v_bill_no, 'duplicate', true);
    end if;
  end if;

  -- Never sell below the batch MSP (showroom dispatch is not a sale)
  if p_action = 'SALE' and not v_is_showroom then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_msp := null;
      select msp into v_msp from public.inventory_batches
       where shop_id = v_shop and batch_id = nullif(v_item->>'batch_id', '')::uuid;
      v_price := coalesce((v_item->>'final_price')::numeric, 0);
      if coalesce(v_msp, 0) > 0 and v_price < v_msp - 0.01 then
        raise exception 'Cannot sell % below MSP (price %, MSP %).', v_item->>'name', v_price, v_msp;
      end if;
    end loop;
  end if;

  -- Only sell stock the store has. Each batch is locked, so two counters can never sell the
  -- same last pieces. Shops without a warehouse count any stock left on a batch's warehouse
  -- side as store stock (it is moved across first, as the app's self-repair does).
  if p_action = 'SALE' then
    select coalesce((to_jsonb(s) ->> 'disable_warehouse')::boolean, false) into v_no_warehouse
      from public.shop_settings s where s.id = v_shop;
    for v_need in
      select nullif(it->>'batch_id', '')::uuid as batch_id,
             max(it->>'name') as name,
             sum(coalesce((it->>'actual_quantity')::numeric, 0)) as qty
        from jsonb_array_elements(p_items) it
       where nullif(it->>'batch_id', '') is not null
       group by 1
    loop
      select * into v_batch from public.inventory_batches
       where shop_id = v_shop and batch_id = v_need.batch_id
       for update;
      if not found then
        raise exception 'Not enough stock: % is no longer available. Refresh and try again.', v_need.name;
      end if;
      if coalesce(v_no_warehouse, false) and v_batch.stock_store < v_need.qty and v_batch.stock_warehouse > 0 then
        v_move := least(v_batch.stock_warehouse, v_need.qty - v_batch.stock_store);
        update public.inventory_batches
           set stock_store = stock_store + v_move, stock_warehouse = stock_warehouse - v_move
         where shop_id = v_shop and batch_id = v_need.batch_id;
        v_batch.stock_store := v_batch.stock_store + v_move;
      end if;
      if v_batch.stock_store < v_need.qty - 0.0001 then
        raise exception 'Not enough stock: only % of % left. Reduce the quantity and try again.',
          trim(to_char(greatest(v_batch.stock_store, 0), 'FM999999990.##')), v_need.name;
      end if;
    end loop;
  end if;

  -- item lines of a showroom dispatch are logged as SHOWROOM, not SALE
  perform set_config('pos.audit_sale_action', case when v_is_showroom then 'SHOWROOM' else 'SALE' end, true);
  v_result := public.process_pos_transaction_unsafe(p_action, p_location, p_cashier_name, p_items);
  perform set_config('pos.audit_sale_action', '', true);
  v_bill := (v_result->>'bill_id')::uuid;

  update public.bills set
    client_ref     = p_client_ref,
    payment_method = case when p_action = 'SALE' then p_payment_method else null end,
    cash_amount    = coalesce(p_cash_amount, 0),
    upi_amount     = coalesce(p_upi_amount, 0),
    total_amount   = case when p_action = 'SALE' and p_total_amount is not null then p_total_amount else total_amount end,
    customer_name  = coalesce(p_customer_name, customer_name),
    customer_phone = coalesce(p_customer_phone, customer_phone),
    status         = case when v_is_showroom then 'showroom_pending' else status end,
    location       = case when p_action = 'RECEIVE' and p_location = 'Store' then 'Warehouse-Inbound' else location end
  where id = v_bill and shop_id = v_shop;

  -- Screws line. Free screws are billed at ₹0; the amount given away is kept in free_amount.
  if p_action = 'SALE' and p_screw_price is not null then
    insert into public.bill_items (
      bill_id, shop_id, barcode, name, quantity, billable_quantity, actual_quantity,
      price_at_sale, system_price, profit, unit, free_amount
    ) values (
      v_bill, v_shop, 'SCREWS',
      case when coalesce(p_screw_free_amount, 0) > 0 then 'Screws (FREE)' else 'Screws' end,
      1, 1, 1,
      case when coalesce(p_screw_free_amount, 0) > 0 then 0 else p_screw_price end,
      case when coalesce(p_screw_free_amount, 0) > 0 then 0 else p_screw_price end,
      case when coalesce(p_screw_free_amount, 0) > 0 then 0 else p_screw_price end,
      'SET',
      case when coalesce(p_screw_free_amount, 0) > 0 then p_screw_free_amount else null end
    );
  end if;

  -- Running bill number per shop for sales (not showroom dispatches). Same transaction as the
  -- sale, so a failed sale never uses up a number: no gaps.
  if p_action = 'SALE' and not v_is_showroom then
    insert into public.pos_bill_counters as c (shop_id, last_no) values (v_shop, 1)
    on conflict (shop_id) do update set last_no = c.last_no + 1
    returning last_no into v_bill_no;
    update public.bills set bill_no = v_bill_no where id = v_bill and shop_id = v_shop;
  end if;

  -- One summary line per bill / dispatch in the audit log: total, payment, discount, customer
  if p_action = 'SALE' then
    select total_amount into v_total from public.bills where id = v_bill and shop_id = v_shop;
    select coalesce(sum(coalesce(system_price, price_at_sale, 0) * coalesce(billable_quantity, quantity, 0)), 0),
           count(*) filter (where barcode is distinct from 'SCREWS')
      into v_listed, v_lines
      from public.bill_items where bill_id = v_bill and shop_id = v_shop;
    v_disc := greatest(0, round(coalesce(v_listed, 0) - coalesce(v_total, 0), 2));
    v_pay := case
      when v_is_showroom then 'not a sale'
      when p_payment_method = 'SPLIT' then format('UPI ₹%s + Cash ₹%s', to_char(coalesce(p_upi_amount, 0), 'FM99,99,99,990.00'), to_char(coalesce(p_cash_amount, 0), 'FM99,99,99,990.00'))
      else coalesce(p_payment_method, '—') end;
    insert into public.audit_logs (shop_id, action_type, barcode, item_name, changes, performed_by)
    values (
      v_shop,
      case when v_is_showroom then 'SHOWROOM' else 'BILL' end,
      '---',
      case when v_is_showroom then 'Showroom dispatch #' else 'Bill #' end || coalesce(v_bill_no::text, left(v_bill::text, 8)),
      case when v_is_showroom
        then format('Sent %s item(s) to the showroom · value ₹%s%s',
                    v_lines, to_char(coalesce(v_total, 0), 'FM99,99,99,990.00'),
                    case when coalesce(p_customer_name, p_customer_phone) is not null
                         then ' · ' || concat_ws(' ', p_customer_name, p_customer_phone) else '' end)
        else format('Bill ₹%s · %s · %s item(s)%s%s%s',
                    to_char(coalesce(v_total, 0), 'FM99,99,99,990.00'), v_pay, v_lines,
                    case when v_disc > 0.009 then format(' · discount ₹%s', to_char(v_disc, 'FM99,99,99,990.00')) else '' end,
                    case when coalesce(p_screw_free_amount, 0) > 0
                         then format(' · free screws ₹%s', to_char(p_screw_free_amount, 'FM99,99,99,990.00')) else '' end,
                    case when coalesce(p_customer_name, p_customer_phone) is not null
                         then ' · customer ' || concat_ws(' ', p_customer_name, p_customer_phone) else '' end)
      end,
      p_cashier_name
    );
  end if;

  return json_build_object('success', true, 'bill_id', v_bill, 'bill_no', v_bill_no);
end;
$$;
revoke execute on function public.pos_process_sale(text, text, text, jsonb, text, numeric, numeric, numeric, text, text, numeric, text, numeric) from public, anon;
grant execute on function public.pos_process_sale(text, text, text, jsonb, text, numeric, numeric, numeric, text, text, numeric, text, numeric) to authenticated;

notify pgrst, 'reload schema';

commit;
